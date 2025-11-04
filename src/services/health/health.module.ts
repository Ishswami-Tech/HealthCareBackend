import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DatabaseModule } from '@infrastructure/database';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/socket';
import { EmailModule } from '@communication/messaging/email';
import { ErrorsModule } from '@core/errors';

@Module({
  imports: [DatabaseModule, LoggingModule, SocketModule, EmailModule, ErrorsModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
