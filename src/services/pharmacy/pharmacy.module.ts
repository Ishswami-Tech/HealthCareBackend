import { Module } from '@nestjs/common';
import { PharmacyController } from './controllers/pharmacy.controller';
import { PharmacyService } from './services/pharmacy.service';
import { RbacModule } from '@core/rbac/rbac.module';
import { ClinicModule } from '@services/clinic/clinic.module';
import { PaymentModule } from '@payment/payment.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { InventoryService } from '@services/pharmacy-inventory/services/inventory.service';
import { ExpiryAlertService } from '@services/pharmacy-inventory/services/expiry-alert.service';

@Module({
  imports: [RbacModule, ClinicModule, PaymentModule, EventsModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, InventoryService, ExpiryAlertService],
  exports: [PharmacyService],
})
export class PharmacyModule {}
