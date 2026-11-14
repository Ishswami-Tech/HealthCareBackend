import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import * as os from 'os';
import { nowIso } from '@utils/date-time.util';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface TopologyReplica {
  role: 'api' | 'worker';
  nodeId: string;
  nodeName: string;
  replica: string;
  hostname: string;
  pid: number;
  gitSha?: string;
  startedAt: string;
  lastHeartbeat: string;
}

export interface DeploymentTopology {
  self: TopologyReplica;
  replicas: TopologyReplica[];
  totalReplicas: number;
  byRole: Record<string, number>;
  byNode: Record<string, number>;
  registrySource: 'live' | 'unavailable';
}

/**
 * Live deployment-topology registry: each API/worker replica (on any node) heartbeats its own
 * identity into the shared cache with a short TTL, and reads see every replica currently
 * heartbeating. Replaces reading Node's native `cluster` module, which only reflects
 * in-process forking and is always empty here (we scale via containers/replicas, not
 * cluster.fork()). Dead replicas disappear within TTL — no separate cleanup needed.
 */
@Injectable()
export class TopologyHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private static readonly KEY_PREFIX = 'cluster:topology:';
  // Separate plain Set used only to enumerate live replica keys. CacheService.keys()/get() can't
  // be round-tripped here: keys() returns provider-level names with CacheVersioningService's
  // ":vN" suffix already baked in (it bypasses CacheRepository, which is the only layer that
  // knows about versioning), so feeding those names back into get() re-appends the suffix and
  // every lookup misses. sAdd/sMembers/sRem also bypass CacheRepository, so the bare member
  // strings we store round-trip cleanly through get() (which does apply versioning, matching how
  // writeHeartbeat's set() wrote them).
  private static readonly INDEX_KEY = 'cluster:topology:index';
  private static readonly TTL_SECONDS = 45;
  private static readonly INTERVAL_MS = 15000;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly selfKey: string;
  private readonly selfInfo: TopologyReplica;

  constructor(
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {
    // TEMPS_NODE_ID/TEMPS_NODE_NAME/TEMPS_REPLICA are injected automatically by Temps into
    // every deployed container (local or remote node) — no custom deploy wiring needed.
    const role: TopologyReplica['role'] =
      process.env['SERVICE_NAME'] === 'worker' ? 'worker' : 'api';
    const nodeId = process.env['TEMPS_NODE_ID'] || 'local';
    const nodeName = process.env['TEMPS_NODE_NAME'] || os.hostname();
    const replica = process.env['TEMPS_REPLICA'] || '1';
    const startedAt = nowIso();
    this.selfInfo = {
      role,
      nodeId,
      nodeName,
      replica,
      hostname: os.hostname(),
      pid: process.pid,
      ...(process.env['GIT_SHA'] ? { gitSha: process.env['GIT_SHA'] } : {}),
      startedAt,
      lastHeartbeat: startedAt,
    };
    // hostname (the container's own id) makes this unique even for manually-synced replicas
    // (oracle-main, and temps-worker's manual worker) that get no Temps-injected node/replica
    // identity and all run as container pid 1 — without it, every such replica of the same role
    // built the identical key and silently overwrote each other in the registry.
    this.selfKey = `${TopologyHeartbeatService.KEY_PREFIX}${role}:${nodeId}:${replica}:${this.selfInfo.hostname}:${process.pid}`;
  }

  onModuleInit(): void {
    void this.writeHeartbeat();
    this.heartbeatTimer = setInterval(
      () => void this.writeHeartbeat(),
      TopologyHeartbeatService.INTERVAL_MS
    );
    this.heartbeatTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async writeHeartbeat(): Promise<void> {
    if (!this.cacheService) return;
    const payload: TopologyReplica = { ...this.selfInfo, lastHeartbeat: nowIso() };
    try {
      await this.cacheService.set(this.selfKey, payload, TopologyHeartbeatService.TTL_SECONDS);
      // The index entry has no TTL of its own — staleness is detected (and the stale member
      // pruned) on read, via the get() miss once the replica's own entry above expires.
      await this.cacheService.sAdd(TopologyHeartbeatService.INDEX_KEY, this.selfKey);
    } catch (error) {
      void this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to write deployment-topology heartbeat',
        'TopologyHeartbeatService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /** Live snapshot across every currently-heartbeating replica (API + worker, every node). */
  async getTopology(): Promise<DeploymentTopology> {
    if (!this.cacheService) {
      return {
        self: this.selfInfo,
        replicas: [this.selfInfo],
        totalReplicas: 1,
        byRole: { [this.selfInfo.role]: 1 },
        byNode: { [this.selfInfo.nodeName]: 1 },
        registrySource: 'unavailable',
      };
    }

    let members: string[] = [];
    try {
      members = await this.cacheService.sMembers(TopologyHeartbeatService.INDEX_KEY);
    } catch (error) {
      void this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to list deployment-topology registry index',
        'TopologyHeartbeatService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    const fetched = await Promise.all(
      members.map(async member => ({
        member,
        // skipL1: other replicas rewrite these every 15 s; an L1 copy would show a heartbeat up
        // to the whole 45 s TTL old (live replicas drawn as stale, or pruned below).
        value: await this.cacheService!.get<TopologyReplica>(member, { skipL1: true }).catch(
          () => null
        ),
      }))
    );

    // Defence in depth on top of CacheService.get() capping its L1 copy at the entry's remaining
    // TTL: judge staleness by the payload's own lastHeartbeat rather than by a non-null get().
    const freshCutoffMs = TopologyHeartbeatService.TTL_SECONDS * 1000;
    const isFresh = (value: TopologyReplica): boolean =>
      Date.now() - new Date(value.lastHeartbeat).getTime() <= freshCutoffMs;

    const replicas = fetched
      .filter(entry => entry.value !== null && isFresh(entry.value))
      .map(entry => entry.value as TopologyReplica);

    // Prune index members that are missing OR stale, so the index doesn't grow unboundedly
    // across restarts and dead replicas drop out of view within one heartbeat interval instead
    // of lingering for however long this reader's L1 cache happens to hold the old snapshot.
    // Best-effort — a failure just leaves cleanup for the next read.
    const staleMembers = fetched
      .filter(entry => entry.value === null || !isFresh(entry.value))
      .map(entry => entry.member);
    if (staleMembers.length > 0) {
      void this.cacheService
        .sRem(TopologyHeartbeatService.INDEX_KEY, ...staleMembers)
        .catch(() => 0);
    }

    // Guarantee this instance is represented even if its own write hasn't landed/propagated yet
    // (e.g. the very first request right after process start).
    if (!replicas.some(r => r.hostname === this.selfInfo.hostname && r.pid === this.selfInfo.pid)) {
      replicas.push(this.selfInfo);
    }

    const byRole: Record<string, number> = {};
    const byNode: Record<string, number> = {};
    for (const r of replicas) {
      byRole[r.role] = (byRole[r.role] || 0) + 1;
      byNode[r.nodeName] = (byNode[r.nodeName] || 0) + 1;
    }

    replicas.sort(
      (a, b) =>
        a.role.localeCompare(b.role) ||
        a.nodeName.localeCompare(b.nodeName) ||
        a.replica.localeCompare(b.replica)
    );

    return {
      self: this.selfInfo,
      replicas,
      totalReplicas: replicas.length,
      byRole,
      byNode,
      registrySource: 'live',
    };
  }
}
