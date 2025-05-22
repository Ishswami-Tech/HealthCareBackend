import { Module, forwardRef } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicController } from './clinic.controller';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ClinicLocationService } from './services/clinic-location.service';
import { ClinicLocationController } from './cliniclocation/clinic-location.controller';
import { LoggingModule } from '../../shared/logging/logging.module';
import { EventService } from '../../shared/events/event.service';
import { ConfigModule } from '@nestjs/config';
import { GuardsModule } from '../../libs/guards/guards.module';
import { ClinicPermissionService } from './shared/permission.utils';
import { ClinicErrorService } from './shared/error.utils';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClinicUserService } from './services/clinic-user.service';
import { QrModule } from '../../shared/QR/qr.module';
import { SharedModule } from '../../shared/shared.module';

@Module({
  imports: [
    forwardRef(() => SharedModule),
    LoggingModule,
    ConfigModule,
    GuardsModule,
    RateLimitModule,
    EventEmitterModule.forRoot(),
    QrModule
  ],
  controllers: [ClinicController, ClinicLocationController],
  providers: [
    ClinicService, 
    PrismaService, 
    ClinicLocationService,
    EventService,
    ClinicPermissionService,
    ClinicErrorService,
    ClinicUserService
  ],
  exports: [
    ClinicService, 
    ClinicPermissionService,
    ClinicErrorService,
    ClinicUserService,
    ClinicLocationService
  ]
})
export class ClinicModule {} 