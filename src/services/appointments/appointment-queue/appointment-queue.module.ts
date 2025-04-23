import { Module } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { AppointmentQueueController } from './appointment-queue.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../../shared/logging/logging.module';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
  ],
  controllers: [AppointmentQueueController],
  providers: [AppointmentQueueService],
  exports: [AppointmentQueueService],
})
export class AppointmentQueueModule {} 