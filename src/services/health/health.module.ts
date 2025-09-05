import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../../libs/infrastructure/database/prisma/prisma.module';
import { CacheServiceModule } from '../../libs/infrastructure/cache/cache-service.module';
import { LoggingServiceModule } from "../../libs/infrastructure/logging";
import { SocketModule } from '../../libs/communication/socket/socket.module';
import { EmailModule } from '../../libs/communication/messaging/email/email.module';

@Module({
  imports: [
    PrismaModule,
    CacheServiceModule,
    LoggingServiceModule,
    SocketModule,
    EmailModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {} 