import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { setClusterCronLock } from '@core/decorators/cluster-cron.decorator';
import { CacheService } from '@infrastructure/cache/cache.service';

/**
 * Points every `@ClusterCron` job at the shared cache, so each tick runs on one worker replica.
 * Registered only in the worker module. onModuleInit runs before @nestjs/schedule starts its
 * jobs (onApplicationBootstrap), so even the first tick is locked.
 */
@Injectable()
export class ClusterCronLockInitializer implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly cacheService: CacheService) {}

  onModuleInit(): void {
    setClusterCronLock({
      acquireLock: (key, ttlSeconds) => this.cacheService.acquireLock(key, ttlSeconds),
    });
  }

  onModuleDestroy(): void {
    setClusterCronLock(null);
  }
}
