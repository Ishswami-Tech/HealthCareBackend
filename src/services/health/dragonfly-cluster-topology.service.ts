import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import {
  DEFAULT_SENTINEL_MASTER_NAME,
  parseSentinelAddresses,
} from '@infrastructure/cache/utils/cache-connection-target.util';
import { resolveServerName } from './cluster-server-names';

export interface CacheClusterNode {
  role: 'primary' | 'replica';
  serverName: string;
  host: string;
  port: number;
  /** False when Sentinel sees the member down or its replication link broken. */
  healthy: boolean;
}

export interface CacheClusterTopology {
  masterName: string;
  nodes: CacheClusterNode[];
  source: 'live' | 'unavailable';
}

const SENTINEL_TIMEOUT_MS = 2000;

/** Sentinel answers SENTINEL MASTER/REPLICAS with flat [key, value, key, value, ...] arrays. */
function toRecord(fields: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (Array.isArray(fields)) {
    for (let i = 0; i + 1 < fields.length; i += 2) {
      record[String(fields[i])] = String(fields[i + 1]);
    }
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

  constructor(
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

    const masterName =
      process.env['CACHE_SENTINEL_MASTER_NAME']?.trim() || DEFAULT_SENTINEL_MASTER_NAME;
    let sentinels: ReturnType<typeof parseSentinelAddresses>;
    try {
      sentinels = parseSentinelAddresses(process.env['CACHE_SENTINELS'] ?? '');
    } catch {
      sentinels = [];
    }
    if (sentinels.length === 0) {
      return { masterName, nodes: [], source: 'unavailable' };
    }

    let lastError: unknown;
    for (const sentinel of sentinels) {
      const client = new Redis({
        host: sentinel.host,
        port: sentinel.port,
        ...(process.env['CACHE_SENTINEL_PASSWORD']?.trim() && {
          password: process.env['CACHE_SENTINEL_PASSWORD'].trim(),
        }),
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
        const master = toRecord(await client.call('SENTINEL', 'MASTER', masterName));
        const replicas = ((await client.call('SENTINEL', 'REPLICAS', masterName)) as unknown[]).map(
          toRecord
        );
        const topology: CacheClusterTopology = {
          masterName,
          nodes: [this.toNode('primary', master), ...this.toReplicaNodes(replicas)],
          source: 'live',
        };
        this.cached = { topology, timestamp: Date.now() };
        return topology;
      } catch (error) {
        lastError = error;
      } finally {
        client.disconnect();
      }
    }

    void this.loggingService?.log(
      LogType.CACHE,
      LogLevel.WARN,
      'Failed to read cache cluster topology from Sentinel',
      'DragonflyClusterTopologyService',
      { error: lastError instanceof Error ? lastError.message : String(lastError) }
    );
    // Same trade-off as the Postgres view: keep the last known-good snapshot over a blank table.
    return this.cached?.topology ?? { masterName, nodes: [], source: 'unavailable' };
  }

  private toNode(role: CacheClusterNode['role'], fields: Record<string, string>): CacheClusterNode {
    const host = fields['ip'] ?? '';
    const flags = fields['flags'] ?? '';
    const linkOk = role === 'primary' || fields['master-link-status'] === 'ok';
    return {
      role,
      serverName: resolveServerName(host),
      host,
      port: Number(fields['port'] ?? 0),
      healthy: !isDown(flags) && linkOk,
    };
  }

  /**
   * Sentinel can keep a stale, permanently-down entry for a member it has since learned under a
   * different address (e.g. a replica that announces its container port). Drop a down entry when
   * the same host is also listed healthy, so the table shows each member once.
   */
  private toReplicaNodes(replicas: Array<Record<string, string>>): CacheClusterNode[] {
    const nodes = replicas.map(fields => this.toNode('replica', fields));
    const healthyHosts = new Set(nodes.filter(node => node.healthy).map(node => node.host));
    return nodes.filter(node => node.healthy || !healthyHosts.has(node.host));
  }
}
