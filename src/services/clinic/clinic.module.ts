import { Module, forwardRef } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicLocationService } from './services/clinic-location.service';
import { ClinicUserService } from './services/clinic-user.service';
import { ClinicController } from './clinic.controller';
import { ClinicLocationController } from './cliniclocation/clinic-location.controller';
import { ClinicCommunicationModule } from './communication/clinic-communication.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { GuardsModule } from '@core/guards';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';

@Module({
  imports: [
    DatabaseModule,
    LoggingModule,
    GuardsModule,
    CacheModule,
    EventsModule,
    ClinicCommunicationModule,
    forwardRef(() => CommunicationConfigModule), // For CommunicationConfigService injection
  ],
  providers: [ClinicService, ClinicLocationService, ClinicUserService],
  controllers: [ClinicController, ClinicLocationController],
  exports: [ClinicService, ClinicLocationService, ClinicUserService],
})
export class ClinicModule {}
