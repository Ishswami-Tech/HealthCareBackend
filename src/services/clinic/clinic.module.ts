import { Module } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { ClinicController } from './clinic.controller';
import { PrismaService } from '../../libs/infrastructure/database/prisma/prisma.service';
import { ClinicLocationService } from './services/clinic-location.service';
import { ClinicLocationController } from './cliniclocation/clinic-location.controller';
import { LoggingModule } from '../../libs/infrastructure/logging/logging.module';
import { EventService } from '../../libs/infrastructure/events/event.service';
import { ConfigModule } from '@nestjs/config';
import { GuardsModule } from '../../libs/core/guards/guards.module';
import { ClinicErrorService } from './shared/error.utils';
import { RateLimitModule } from '../../libs/utils/rate-limit/rate-limit.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClinicUserService } from './services/clinic-user.service';
import { QrModule } from '../../libs/utils/QR/qr.module';
  import { PermissionsModule } from '../../libs/infrastructure/permissions';
import { JwtModule } from '@nestjs/jwt';
import { jwtConfig } from '../../config/jwt.config';
import { RedisModule } from '../../libs/infrastructure/cache/redis/redis.module';

@Module({
  imports: [
    LoggingModule,
    ConfigModule,
    GuardsModule,
    RateLimitModule,
    EventEmitterModule.forRoot(),
    QrModule,
    PermissionsModule,
    JwtModule.register(jwtConfig),
    RedisModule
  ],
  controllers: [ClinicController, ClinicLocationController],
  providers: [
    ClinicService, 
    PrismaService, 
    ClinicLocationService,
    EventService,
    ClinicErrorService,
    ClinicUserService
  ],
  exports: [
    ClinicService, 
    ClinicErrorService,
    ClinicUserService,
    ClinicLocationService
  ]
})
export class ClinicModule {} 