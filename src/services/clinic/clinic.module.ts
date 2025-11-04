import { Module } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicLocationService } from './services/clinic-location.service';
import { ClinicUserService } from './services/clinic-user.service';
import { ClinicController } from './clinic.controller';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';

@Module({
  imports: [DatabaseModule, LoggingModule],
  providers: [ClinicService, ClinicLocationService, ClinicUserService],
  controllers: [ClinicController],
  exports: [ClinicService, ClinicLocationService, ClinicUserService],
})
export class ClinicModule {}
