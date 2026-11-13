import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@config/config.service';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, type CacheClusterNode, type CacheClusterTopology } from '@core/types';
import {
  DEFAULT_SENTINEL_MASTER_NAME,
  getCacheConnectionTarget,
} from '@infrastructure/cache/utils/cache-connection-target.util';
import { resolveServerName } from '@services/health/cluster-server-names';

const SENTINEL_TIMEOUT_MS = 2000;

/** A Sentinel reply entry: a flat [key, value, key, value, ...] array. */
type SentinelFields = Array<string | number>;

/** A member as Sentinel reports it; the host stays internal (used to de-duplicate entries). */
interface SentinelMember extends CacheClusterNode {
  host: string;
}

/** Narrows a raw Sentinel reply (ioredis types `call()` results loosely) to a flat field array. */
function isSentinelFields(reply: unknown): reply is SentinelFields {
  return (
    Array.isArray(reply) &&
    reply.every(item => typeof item === 'string' || typeof item === 'number')
  );
}

function toRecord(fields: SentinelFields): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    record[String(fields[i])] = String(fields[i + 1]);
  }
  return record;
}

function isDown(flags: string): boolean {
  return /\b(s_down|o_down|disconnected)\b/.test(flags);
}

/**
 * Live primary/replica topology of the Dragonfly cache, read on demand from Redis Sentinel
 * (CACHE_SENTINELS) for the dashboard - the same source the app's clients use to find the
 * primary, so it shows what the app actually connects to. Cached briefly like the Postgres
 * view; 'unavailable' when Sentinel is not configured or cannot be reached.
 */
@Injectable()
export class DragonflyClusterTopologyService {
  private static readonly CACHE_TTL_MS = 20000;
  private cached: { topology: CacheClusterTopology; timestamp: number } | null = null;
  /** When Sentinel last could not be read; skips re-asking (and its timeouts) for CACHE_TTL_MS. */
  private lastFailureAt = 0;

  constructor(
    @Optional()
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  async getTopology(): Promise<CacheClusterTopology> {
    if (
      this.cached &&
      Date.now() - this.cached.timestamp < DragonflyClusterTopologyService.CACHE_TTL_MS
    ) {
      return this.cached.topology;
    }

    const unavailable: CacheClusterTopology = {
      masterName: DEFAULT_SENTINEL_MASTER_NAME,
      nodes: [],
      source: 'unavailable',
    };
    if (Date.now() - this.lastFailureAt < DragonflyClusterTopologyService.CACHE_TTL_MS) {
      return this.cached?.topology ?? unavailable;
    }

    let target: ReturnType<typeof getCacheConnectionTarget>;
    try {
      // The same Sentinel settings the cache clients connect with (no direct host fallback here).
      target = getCacheConnectionTarget(key => this.configService?.getEnv(key), {
        host: '',
        port: 0,
      });
    } catch {
      return unavailable;
    }
    if (!('sentinels' in target)) {
      return unavailable;
    }
    const masterName = target.name;

    let lastError: Error | null = null;
    for (const sentinel of target.sentinels) {
      const client = new Redis({
        host: sentinel.host,
        port: sentinel.port,
        ...(target.sentinelPassword && { password: target.sentinelPassword }),
        lazyConnect: true,
        connectTimeout: SENTINEL_TIMEOUT_MS,
        commandTimeout: SENTINEL_TIMEOUT_MS,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      try {
        await client.connect();
        const masterReply = await client.call('SENTINEL', 'MASTER', masterName);
        const replicasReply = await client.call('SENTINEL', 'REPLICAS', masterName);
        if (!isSentinelFields(masterReply) || !Array.isArray(replicasReply)) {
          throw new HealthcareError(
            ErrorCode.CACHE_OPERATION_FAILED,
            `Unexpected SENTINEL reply for master "${masterName}"`,
            undefined,
            { masterName },
            'DragonflyClusterTopologyService'
          );
        }
        const replicas = replicasReply.filter(isSentinelFields).map(toRecord);
        const topology: CacheClusterTopology = {
          masterName,
          nodes: [
            this.toNode('primary', toRecord(masterReply)),
            ...this.toReplicaNodes(replicas),
          ].map(({ role, serverName, healthy }) => ({ role, serverName, healthy })),
          source: 'live',
        };
        this.cached = { topology, timestamp: Date.now() };
        this.lastFailureAt = 0;
        return topology;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      } finally {
        client.disconnect();
      }
    }

    this.lastFailureAt = Date.now();
    void this.loggingService?.log(
      LogType.CACHE,
      LogLevel.WARN,
      'Failed to read cache cluster topology from Sentinel',
      'DragonflyClusterTopologyService',
      { error: lastError?.message }
    );
    // Same trade-off as the Postgres view: keep the last known-good snapshot over a blank table.
    return this.cached?.topology ?? { ...unavailable, masterName };
  }

  private toNode(role: CacheClusterNode['role'], fields: Record<string, string>): SentinelMember {
    const host = fields['ip'] ?? '';
    const flags = fields['flags'] ?? '';
    const linkOk = role === 'primary' || fields['master-link-status'] === 'ok';
    return {
      role,
      serverName: resolveServerName(host),
      host,
      healthy: !isDown(flags) && linkOk,
    };
  }

  /**
   * Sentinel can keep a stale, permanently-down entry for a member it has since learned under a
   * different address (e.g. a replica that announces its container port). Drop a down entry when
   * the same host is also listed healthy, so the table shows each member once.
   */
  private toReplicaNodes(replicas: Array<Record<string, string>>): SentinelMember[] {
    const nodes = replicas.map(fields => this.toNode('replica', fields));
    const healthyHosts = new Set(nodes.filter(node => node.healthy).map(node => node.host));
    return nodes.filter(node => node.healthy || !healthyHosts.has(node.host));
  }
}
