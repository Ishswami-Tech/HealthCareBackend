import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { AyurvedaModule } from '@services/ayurveda/ayurveda.module';
import { ComplianceModule } from '@services/compliance/compliance.module';
import { DoctorsModule } from '@services/doctors/doctors.module';
import { EHRModule } from '@services/ehr/ehr.module';
import { FhirController } from '@services/fhir/fhir.controller';
import { FhirExceptionFilter } from '@services/fhir/fhir-exception.filter';
import { FhirService } from '@services/fhir/fhir.service';
import { PatientsModule } from '@services/patients/patients.module';
import { PatientVisitsModule } from '@services/patient-visits/patient-visits.module';

/**
 * Read-only HL7 FHIR R4 layer. Depends one-way on the clinical modules it reads from; nothing
 * imports this module back.
 */
@Module({
  imports: [
    DatabaseModule,
    GuardsModule,
    RateLimitModule,
    RbacModule,
    LoggingModule,
    ErrorsModule,
    AyurvedaModule,
    ComplianceModule,
    DoctorsModule,
    EHRModule,
    PatientsModule,
    PatientVisitsModule,
  ],
  controllers: [FhirController],
  providers: [FhirService, FhirExceptionFilter],
})
export class FhirModule {}
