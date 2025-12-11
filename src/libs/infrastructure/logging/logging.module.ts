import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
// ConfigModule is @Global() - no need to import it explicitly
// ResilienceModule is not needed here - LoggingService doesn't directly depend on it
// If CircuitBreakerService is needed, it should be injected where it's used, not at module level
import { LoggingService } from './logging.service';
import { LoggingController } from './logging.controller';
import { LoggingHealthMonitorService } from './logging-health-monitor.service';

@Global()
@Module({
  imports: [
    HttpModule, // HTTP client for health checks
    // ConfigModule is @Global() - available for injection without explicit import
    // Removed ResilienceModule import - it was causing circular dependency issues
    // ResilienceModule can be imported where CircuitBreakerService is actually needed
  ],
  controllers: [LoggingController],
  providers: [LoggingService, LoggingHealthMonitorService],
  exports: [
    LoggingService,
    // Export health monitor for HealthService
    LoggingHealthMonitorService,
  ],
})
export class LoggingModule {}
