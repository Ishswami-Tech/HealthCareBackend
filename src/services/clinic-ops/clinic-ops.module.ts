/**
 * Clinic Ops Module
 * @module ClinicOps
 * @description Clinic-admin / assistant-doctor / front-desk operations: leave & holidays, check-in
 * log, queue priority, Rx drafts, direct dispense + stock view, billing views, staff invites.
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging';
import { EventsModule } from '@infrastructure/events/events.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { PharmacyModule } from '@services/pharmacy/pharmacy.module';
import { PharmacyInventoryModule } from '@services/pharmacy-inventory/pharmacy-inventory.module';
import { QrModule } from '@utils/QR/qr.module';
import { OpsDbService } from './services/ops-db.service';
import { LeaveService } from './services/leave.service';
import { CheckInLogService } from './services/check-in-log.service';
import { QueueOpsService } from './services/queue-ops.service';
import { RxDraftService } from './services/rx-draft.service';
import { DirectDispenseService } from './services/direct-dispense.service';
import { BillingOpsService } from './services/billing-ops.service';
import { StaffAdminService } from './services/staff-admin.service';
import { ClinicAuditService } from './services/audit.service';
import { ClinicDayAuditListener } from './services/clinic-day-audit.listener';
import { HandoverService } from './services/handover.service';
import { BatchActionsService } from './services/batch-actions.service';
import { PatientOpsService } from './services/patient-ops.service';
import { DoctorOpsService } from './services/doctor-ops.service';
import {
  DoctorOpsController,
  LabBookingController,
  PharmacyOpsController,
  SupportController,
} from './controllers/extra-ops.controller';
import { ClinicHolidaysController, LeaveController } from './controllers/leave.controller';
import { CheckInLogController, QueueOpsController } from './controllers/front-desk.controller';
import { DirectDispenseController, RxDraftController } from './controllers/clinical-ops.controller';
import { BillingOpsController, StaffAdminController } from './controllers/admin-ops.controller';

// The AppointmentQueueService comes from the global QueueModule. AppointmentsModule provides its own
// CheckInLogService instance, so nothing here imports the appointments module back.
@Module({
  imports: [
    DatabaseModule,
    LoggingModule,
    EventsModule,
    GuardsModule,
    RbacModule,
    PharmacyModule,
    PharmacyInventoryModule,
    QrModule,
  ],
  controllers: [
    LeaveController,
    ClinicHolidaysController,
    CheckInLogController,
    QueueOpsController,
    RxDraftController,
    DirectDispenseController,
    BillingOpsController,
    StaffAdminController,
    PharmacyOpsController,
    LabBookingController,
    SupportController,
    DoctorOpsController,
  ],
  providers: [
    OpsDbService,
    LeaveService,
    CheckInLogService,
    QueueOpsService,
    RxDraftService,
    DirectDispenseService,
    BillingOpsService,
    StaffAdminService,
    ClinicAuditService,
    ClinicDayAuditListener,
    HandoverService,
    BatchActionsService,
    PatientOpsService,
    DoctorOpsService,
  ],
  exports: [CheckInLogService, LeaveService, OpsDbService, ClinicAuditService],
})
export class ClinicOpsModule {}
