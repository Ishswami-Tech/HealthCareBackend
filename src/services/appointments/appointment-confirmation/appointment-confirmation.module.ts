import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { QrModule } from '../../../shared/QR/qr.module';
import { QueueModule } from '../../../shared/queue/queue.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { AppointmentConfirmationController } from './appointment-confirmation.controller';
import { AppointmentConfirmationService } from './appointment-confirmation.service';

@Module({
  imports: [
    PrismaModule,
    QrModule,
    QueueModule.register('appointment-queue'),
    LoggingModule,
  ],
  controllers: [AppointmentConfirmationController],
  providers: [AppointmentConfirmationService],
  exports: [AppointmentConfirmationService],
})
export class AppointmentConfirmationModule {} 