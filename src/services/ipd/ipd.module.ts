/**
 * IPD (In-Patient Department) Module
 * @module IPD
 * @description NestJS module wiring all IPD management services
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';
import { GuardsModule } from '@core/guards/guards.module';

import { AdmissionController } from '@services/ipd/controllers/admission.controller';
import { BedController } from '@services/ipd/controllers/bed.controller';
import { WardController } from '@services/ipd/controllers/ward.controller';
import { AdmissionService } from '@services/ipd/services/admission.service';
import { BedManagementService } from '@services/ipd/services/bed-management.service';
import { WardService } from '@services/ipd/services/ward.service';
import { DischargeSummaryService } from '@services/ipd/services/discharge-summary.service';
import { NurseStationService } from '@services/ipd/services/nurse-station.service';
import { NurseStationClinicalService } from '@services/ipd/services/nurse-station-clinical.service';
import { IpdBillingService } from '@services/ipd/services/ipd-billing.service';
import { IpdBillingCalculationService } from '@services/ipd/services/ipd-billing-calculation.service';

/**
 * NestJS module for IPD (In-Patient Department) management APIs.
 *
 * Provides:
 * - Patient admission, transfer, and discharge workflows
 * - Bed board and availability management
 * - Ward configuration and statistics
 * - Nursing notes, vitals flowsheet, and bedside medication administration
 * - Discharge summary generation (PDF-ready)
 * - Daily bed charge accrual and IPD billing
 *
 * Required permissions:
 * - IPD_READ: View admissions, beds, wards, nursing notes
 * - IPD_WRITE: Create/update admissions, transfer beds, discharge
 * - IPD_ADMIN: Ward/bed configuration, billing operations
 *
 * @public
 */
@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    LoggingModule,
    ErrorsModule,
    EventsModule,
    RbacModule,
    GuardsModule,
  ],
  controllers: [AdmissionController, BedController, WardController],
  providers: [
    AdmissionService,
    BedManagementService,
    WardService,
    DischargeSummaryService,
    NurseStationService,
    NurseStationClinicalService,
    IpdBillingService,
    IpdBillingCalculationService,
  ],
  exports: [
    AdmissionService,
    BedManagementService,
    WardService,
    DischargeSummaryService,
    NurseStationService,
    IpdBillingService,
  ],
})
export class IpdModule {}
