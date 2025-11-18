import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseModule } from '@infrastructure/database';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/channels/socket';
import { EmailModule } from '@communication/channels/email';
import { ErrorsModule } from '@core/errors';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';
import { CommunicationModule } from '@communication/communication.module';

@Module({
  imports: [
    ConfigModule, // Explicitly import ConfigModule to ensure ConfigService is available
    DatabaseModule,
    CacheModule,
    QueueModule,
    LoggingModule,
    CommunicationModule, // Import CommunicationModule to access CommunicationHealthMonitorService
    SocketModule,
    EmailModule,
    ErrorsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
