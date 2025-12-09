import { Module, Global, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@config';
import { LoggingService } from './logging.service';
import { LoggingController } from './logging.controller';
import { LoggingHealthMonitorService } from './logging-health-monitor.service';
import { ResilienceModule } from '@core/resilience';

@Global()
@Module({
  imports: [
    ConfigModule, // Ensure ConfigService is available for LoggingService
    forwardRef(() => ResilienceModule), // Provides CircuitBreakerService
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
