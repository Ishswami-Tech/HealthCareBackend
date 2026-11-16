import {
  Inject,
  Injectable,
  forwardRef,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import {
  REFUSING_CLUSTER_CRON_LOCK,
  setClusterCronLock,
  type ClusterCronLock,
  type ClusterCronLockOutcome,
} from '@core/decorators/cluster-cron.decorator';
import { LogLevel, LogType } from '@core/types';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';

/** One "cache unavailable" warning per job per this long, however many ticks it affects. */
export const CLUSTER_CRON_UNAVAILABLE_WARN_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Points every `@ClusterCron` job at the shared cache, so each tick runs on one worker replica.
 * Registered only in the worker module. onModuleInit runs before @nestjs/schedule starts its jobs
 * (onApplicationBootstrap), so even the first tick is locked; onModuleDestroy runs before the
 * scheduler stops them (onApplicationShutdown), so a replica that is shutting down starts no tick.
 *
 * forwardRef, like the other worker-root providers, so an import cycle around CacheService or
 * LoggingService can never leave a constructor parameter undefined at boot.
 */
@Injectable()
export class ClusterCronLockInitializer implements OnModuleInit, OnModuleDestroy {
  private readonly lastUnavailableWarning = new Map<string, number>();

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  readonly lock: ClusterCronLock = {
    tryLock: async (key: string, ttlSeconds: number): Promise<ClusterCronLockOutcome> => {
      if (await this.cacheService.acquireLock(key, ttlSeconds)) {
        return 'acquired';
      }
      // acquireLock is false both when another replica holds the lock and when the cache cannot
      // be asked. (If the lock expired in between, this reads as unavailable: one extra run.)
      return (await this.cacheService.isLockHeld(key)) ? 'held' : 'unavailable';
    },
    onUnavailable: (job: string): void => {
      const now = Date.now();
      const last = this.lastUnavailableWarning.get(job) ?? 0;
      if (now - last < CLUSTER_CRON_UNAVAILABLE_WARN_INTERVAL_MS) {
        return;
      }
      this.lastUnavailableWarning.set(job, now);
      void this.loggingService
        .log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Cron lock unavailable (cache unreachable): ${job} runs on this replica, and may run on others too`,
          'ClusterCron',
          { job }
        )
        .catch(() => undefined);
    },
  };

  onModuleInit(): void {
    setClusterCronLock(this.lock);
  }

  onModuleDestroy(): void {
    setClusterCronLock(REFUSING_CLUSTER_CRON_LOCK);
  }
}
