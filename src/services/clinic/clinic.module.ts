import { Module } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicController } from './clinic.controller';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ClinicDatabaseService } from './clinic-database.service';
import { ClinicLocationService } from './cliniclocation/clinic-location.service';
import { ClinicLocationController } from './cliniclocation/clinic-location.controller';
import { LoggingModule } from '../../shared/logging/logging.module';
import { EventService } from '../../shared/events/event.service';
import { ConfigModule } from '@nestjs/config';
import { GuardsModule } from '../../libs/guards/guards.module';
import { ClinicPermissionService } from './shared/permission.utils';
import { ClinicErrorService } from './shared/error.utils';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    LoggingModule,
    ConfigModule,
    GuardsModule,
    RateLimitModule,
    EventEmitterModule.forRoot()
  ],
  controllers: [ClinicController, ClinicLocationController],
  providers: [
    ClinicService, 
    PrismaService, 
    ClinicDatabaseService, 
    ClinicLocationService,
    EventService,
    ClinicPermissionService,
    ClinicErrorService
  ],
  exports: [
    ClinicService, 
    ClinicDatabaseService, 
    ClinicPermissionService,
    ClinicErrorService
  ]
})
export class ClinicModule {} 