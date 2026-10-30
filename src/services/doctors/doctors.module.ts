import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { GuardsModule } from '@core/guards/guards.module';
import { AppointmentsModule } from '@services/appointments/appointments.module';
import { DoctorsService } from './doctors.service';
import { DoctorsController } from './controllers/doctors.controller';
import { DayAvailabilityService } from './day-availability.service';
import { DayAvailabilityController } from './controllers/day-availability.controller';
import { ReassignmentCascadeService } from './reassignment-cascade.service';
import { ReassignmentProposalService } from './reassignment-proposal.service';
import { ReassignmentProposalStore } from './reassignment-proposal.store';
import { ReassignmentProposalController } from './controllers/reassignment-proposal.controller';

@Module({
  imports: [DatabaseModule, LoggingModule, EventsModule, GuardsModule, AppointmentsModule],
  controllers: [DoctorsController, DayAvailabilityController, ReassignmentProposalController],
  providers: [
    DoctorsService,
    DayAvailabilityService,
    ReassignmentCascadeService,
    ReassignmentProposalStore,
    ReassignmentProposalService,
  ],
  exports: [
    DoctorsService,
    DayAvailabilityService,
    ReassignmentCascadeService,
    ReassignmentProposalStore,
  ],
})
export class DoctorsModule {}
