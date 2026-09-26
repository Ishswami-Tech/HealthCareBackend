import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { AyurvedaModule } from '@services/ayurveda/ayurveda.module';
import { PatientVisitsController } from '@services/patient-visits/controllers/patient-visits.controller';
import { FamilyMembersController } from '@services/patient-visits/controllers/family-members.controller';
import { PatientVisitsService } from '@services/patient-visits/patient-visits.service';
import { VisitVitalsExaminationService } from '@services/patient-visits/services/visit-vitals-examination.service';
import { FamilyMembersService } from '@services/patient-visits/services/family-members.service';

// One-way dependency onto AyurvedaModule (for ClassicalExamService). Nothing
// imports this module back, so no forwardRef is needed anywhere here.
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
    AyurvedaModule,
  ],
  controllers: [PatientVisitsController, FamilyMembersController],
  providers: [PatientVisitsService, VisitVitalsExaminationService, FamilyMembersService],
  exports: [PatientVisitsService, VisitVitalsExaminationService, FamilyMembersService],
})
export class PatientVisitsModule {}
