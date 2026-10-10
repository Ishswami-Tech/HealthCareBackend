import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { LoggingModule } from '@infrastructure/logging';
import { ComplianceModule } from '@services/compliance/compliance.module';
import { PatientDirectoryController } from './patient-directory.controller';
import { PatientDirectoryService } from './patient-directory.service';

/** The staff patient list: search, filters and paging that run in the database. */
@Module({
  imports: [
    DatabaseModule,
    LoggingModule,
    GuardsModule,
    RbacModule,
    RateLimitModule,
    ComplianceModule,
  ],
  controllers: [PatientDirectoryController],
  providers: [PatientDirectoryService],
  exports: [PatientDirectoryService],
})
export class PatientDirectoryModule {}
