import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { LoggingModule } from '@infrastructure/logging';
import { EHRModule } from '@services/ehr/ehr.module';
import { CompliancePatientAccess } from '@services/compliance/services/compliance-patient-access.service';
import { UhidAllocatorService } from '@services/compliance/services/uhid-allocator.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { ConsentService } from '@services/compliance/services/consent.service';
import { PatientIdentifierService } from '@services/compliance/services/patient-identifier.service';
import { ConsentController } from '@services/compliance/controllers/consent.controller';
import { PatientIdentifierController } from '@services/compliance/controllers/patient-identifier.controller';

/**
 * Compliance building blocks shared across clinical services: PHI access auditing, the
 * append-only patient consent ledger and per-clinic patient identifiers (UHID / ABHA).
 */
@Module({
  imports: [DatabaseModule, LoggingModule, GuardsModule, RbacModule, RateLimitModule, EHRModule],
  controllers: [ConsentController, PatientIdentifierController],
  providers: [
    PhiAuditService,
    CompliancePatientAccess,
    ConsentService,
    PatientIdentifierService,
    UhidAllocatorService,
  ],
  exports: [PhiAuditService, ConsentService, PatientIdentifierService, UhidAllocatorService],
})
export class ComplianceModule {}
