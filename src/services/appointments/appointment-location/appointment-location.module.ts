import { Module } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';
import { AppointmentLocationController } from './appointment-location.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { CacheModule } from '../../../shared/cache/cache.module';
import { LoggingModule } from '../../../shared/logging/logging.module';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    LoggingModule,
  ],
  controllers: [AppointmentLocationController],
  providers: [AppointmentLocationService],
  exports: [AppointmentLocationService],
})
export class AppointmentLocationModule {} 