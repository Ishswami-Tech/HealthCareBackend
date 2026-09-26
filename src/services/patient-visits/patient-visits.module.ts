import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { AyurvedaModule } from '@services/ayurveda/ayurveda.module';
import { PatientVisitsController } from '@services/patient-visits/controllers/patient-visits.controller';
import { FamilyMembersController } from '@services/patient-visits/controllers/family-members.controller';
import { VisitTherapyController } from '@services/patient-visits/controllers/visit-therapy.controller';
import { VisitDietChartController } from '@services/patient-visits/controllers/visit-diet-chart.controller';
import { PatientDocumentsController } from '@services/patient-visits/controllers/patient-documents.controller';
import { PatientVisitsService } from '@services/patient-visits/patient-visits.service';
import { VisitVitalsExaminationService } from '@services/patient-visits/services/visit-vitals-examination.service';
import { FamilyMembersService } from '@services/patient-visits/services/family-members.service';
import { VisitTherapyService } from '@services/patient-visits/services/visit-therapy.service';
import { VisitDietChartService } from '@services/patient-visits/services/visit-diet-chart.service';
import { PatientDocumentsService } from '@services/patient-visits/services/patient-documents.service';

// One-way dependencies onto AyurvedaModule (ClassicalExamService) and
// StorageModule (S3StorageService for patient documents). Nothing imports this
// module back, so no forwardRef is needed anywhere here. BillingService is
// resolved lazily via ModuleRef ('BILLING_SERVICE') where needed to avoid a
// PatientVisits <-> Billing import cycle.
@Module({
  imports: [
    DatabaseModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    LoggingModule,
    ErrorsModule,
    CacheModule,
    StorageModule,
    AyurvedaModule,
  ],
  controllers: [
    PatientVisitsController,
    FamilyMembersController,
    VisitTherapyController,
    VisitDietChartController,
    PatientDocumentsController,
  ],
  providers: [
    PatientVisitsService,
    VisitVitalsExaminationService,
    FamilyMembersService,
    VisitTherapyService,
    VisitDietChartService,
    PatientDocumentsService,
  ],
  exports: [
    PatientVisitsService,
    VisitVitalsExaminationService,
    FamilyMembersService,
    VisitTherapyService,
    VisitDietChartService,
    PatientDocumentsService,
  ],
})
export class PatientVisitsModule {}
