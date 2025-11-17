// External imports
import { Module, Global, OnModuleInit } from '@nestjs/common';

// Internal imports - Infrastructure
// ConfigModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - no need to import it explicitly
import { DragonflyService } from './dragonfly.service';

@Global()
@Module({
  imports: [
    // ConfigModule and LoggingModule are @Global() - they're available everywhere
    // No need to import them explicitly
  ],
  providers: [DragonflyService],
  exports: [DragonflyService],
})
export class DragonflyModule implements OnModuleInit {
  // Force eager initialization by injecting DragonflyService in the module
  constructor(private readonly dragonflyService: DragonflyService) {
    // This ensures DragonflyService is instantiated when the module is loaded
    // which will trigger onModuleInit lifecycle hook
  }

  async onModuleInit(): Promise<void> {
    // Only initialize DragonflyService if Dragonfly is the selected cache provider
    // This prevents unnecessary connections when using Redis or other providers
    const cacheProvider =
      process.env['CACHE_PROVIDER']?.toLowerCase() || 'dragonfly'; // Default to Dragonfly

    if (cacheProvider === 'dragonfly') {
      // Explicitly trigger DragonflyService.onModuleInit by calling it
      // This ensures the connection is established even if NestJS lifecycle hooks
      // don't fire in the expected order
      if (
        this.dragonflyService &&
        typeof (this.dragonflyService as { onModuleInit?: () => Promise<void> }).onModuleInit ===
          'function'
      ) {
        await (this.dragonflyService as { onModuleInit: () => Promise<void> }).onModuleInit();
      }
    }
    // If not using Dragonfly, skip initialization to avoid unnecessary connections
  }
}

