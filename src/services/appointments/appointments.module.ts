import { Module } from '@nestjs/common';
import { AppointmentController } from './appointments.controller';
import { AppointmentLocationModule } from './appointment-location/appointment-location.module';
import { AppointmentConfirmationModule } from './appointment-confirmation/appointment-confirmation.module';
import { AppointmentSocketModule } from './appointment-socket/appointment-socket.module';
import { AppointmentProcessorModule } from './appointment-processor/appointment-processor.module';
import { PrismaModule } from '../../shared/database/prisma/prisma.module';
import { QrModule } from '../../shared/QR/qr.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { AppointmentService } from './appointments.service';

@Module({
  imports: [
    PrismaModule,
    QueueModule.register('appointment-queue'),
    AppointmentLocationModule,
    AppointmentConfirmationModule,
    AppointmentSocketModule,
    AppointmentProcessorModule,
    QrModule,
    LoggingModule,
  ],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {} 