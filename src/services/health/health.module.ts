import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseModule } from '@infrastructure/database';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/socket';
import { EmailModule } from '@communication/messaging/email';
import { ErrorsModule } from '@core/errors';
import { CacheModule } from '@infrastructure/cache';
import { QueueModule } from '@infrastructure/queue';

@Module({
  imports: [
    ConfigModule,  // Explicitly import ConfigModule to ensure ConfigService is available
    DatabaseModule,
    CacheModule,
    QueueModule,
    LoggingModule,
    SocketModule,
    EmailModule,
    ErrorsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
