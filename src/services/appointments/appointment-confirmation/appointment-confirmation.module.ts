import { Module } from '@nestjs/common';
import { AppointmentConfirmationController } from './appointment-confirmation.controller';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { SharedModule } from '../../../shared/shared.module';
import { LoggingModule } from '../../../shared/logging/logging.module';

@Module({
  imports: [
    SharedModule,
    LoggingModule,
  ],
  controllers: [AppointmentConfirmationController],
  providers: [AppointmentConfirmationService],
  exports: [AppointmentConfirmationService],
})
export class AppointmentConfirmationModule {} 