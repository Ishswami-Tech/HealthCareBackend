// External imports
import { Module, Global, OnModuleInit } from '@nestjs/common';

// Internal imports - Infrastructure
// ConfigModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - no need to import it explicitly
import { RedisService } from '@infrastructure/cache/redis/redis.service';

@Global()
@Module({
  imports: [
    // ConfigModule and LoggingModule are @Global() - they're available everywhere
    // No need to import them explicitly
  ],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule implements OnModuleInit {
  // Force eager initialization by injecting RedisService in the module
  constructor(private readonly redisService: RedisService) {
    // This ensures RedisService is instantiated when the module is loaded
    // which will trigger onModuleInit lifecycle hook
  }

  async onModuleInit(): Promise<void> {
    // Only initialize RedisService if Redis is the selected cache provider
    // This prevents unnecessary connections when using Dragonfly or other providers
    const cacheProvider = process.env['CACHE_PROVIDER']?.toLowerCase() || 'dragonfly'; // Default to Dragonfly

    if (cacheProvider === 'redis') {
      // Explicitly trigger RedisService.onModuleInit by calling it
      // This ensures the connection is established even if NestJS lifecycle hooks
      // don't fire in the expected order
      if (
        this.redisService &&
        typeof (this.redisService as { onModuleInit?: () => Promise<void> }).onModuleInit ===
          'function'
      ) {
        await (this.redisService as { onModuleInit: () => Promise<void> }).onModuleInit();
      }
    }
    // If not using Redis, skip initialization to avoid unnecessary connections
  }
}
