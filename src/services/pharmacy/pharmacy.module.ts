import { Module } from '@nestjs/common';
import { PharmacyController } from './controllers/pharmacy.controller';
import { PharmacyService } from './services/pharmacy.service';
import { RbacModule } from '@core/rbac/rbac.module';
import { ClinicModule } from '@services/clinic/clinic.module';

@Module({
  imports: [RbacModule, ClinicModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
