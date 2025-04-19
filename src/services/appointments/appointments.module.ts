import { Module } from '@nestjs/common';
import { AppointmentController } from './appointments.controller';
import { AppointmentLocationModule } from './appointment-location/appointment-location.module';
import { AppointmentConfirmationModule } from './appointment-confirmation/appointment-confirmation.module';
import { AppointmentSocketModule } from './appointment-socket/appointment-socket.module';
import { AppointmentProcessorModule } from './appointment-processor/appointment-processor.module';
import { SharedModule } from '../../shared/shared.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { AppointmentService } from './appointments.service';

@Module({
  imports: [
    SharedModule,
    AppointmentLocationModule,
    AppointmentConfirmationModule,
    AppointmentSocketModule,
    AppointmentProcessorModule,
    LoggingModule,
  ],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {} 