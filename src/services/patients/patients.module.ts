import { Module, forwardRef } from '@nestjs/common';
import { PatientsController } from './controllers/patients.controller';
import { PatientsService } from './patients.service';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { StorageModule } from '@infrastructure/storage/storage.module';

// Cross-module imports are wrapped in `forwardRef` because some of these
// services (notably `AppointmentsService`) deliberately avoid importing
// `PatientsService` to dodge circular deps. forwardRef is harmless when
// the dependency is one-way.
import { AppointmentsModule } from '@services/appointments/appointments.module';
import { EHRModule as EhrModule } from '@services/ehr/ehr.module';
import { BillingModule } from '@services/billing/billing.module';
import { PharmacyModule } from '@services/pharmacy/pharmacy.module';

@Module({
  imports: [
    DatabaseModule,
    LoggingModule,
    RbacModule,
    StorageModule,
    forwardRef(() => AppointmentsModule),
    forwardRef(() => EhrModule),
    forwardRef(() => BillingModule),
    forwardRef(() => PharmacyModule),
  ],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
