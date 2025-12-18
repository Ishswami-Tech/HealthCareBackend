import { Module, Global, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
// ConfigModule is @Global() - no need to import it explicitly
// ResilienceModule is not needed here - LoggingService doesn't directly depend on it
// If CircuitBreakerService is needed, it should be injected where it's used, not at module level
import { LoggingService } from './logging.service';
import { LoggingHealthMonitorService } from './logging-health-monitor.service';

/**
 * LoggingModule
 *
 * Global module that provides LoggingService and LoggingHealthMonitorService.
 * Controllers are in a separate LoggingControllersModule to avoid duplicate registration.
 *
 * This module can be safely imported in multiple places without causing controller duplication.
 */
@Global()
@Module({
  imports: [
    forwardRef(() => HttpModule), // HTTP client for health checks - use forwardRef to break circular dependency
    // ConfigModule is @Global() - available for injection without explicit import
    // Removed ResilienceModule import - it was causing circular dependency issues
    // ResilienceModule can be imported where CircuitBreakerService is actually needed
  ],
  providers: [
    LoggingService,
    LoggingHealthMonitorService,
    // Alias token for safer injection across infra modules
    {
      provide: 'LOGGING_SERVICE',
      useExisting: LoggingService,
    },
  ],
  exports: [
    LoggingService,
    'LOGGING_SERVICE',
    // Export health monitor for HealthService
    LoggingHealthMonitorService,
  ],
})
export class LoggingModule {}
