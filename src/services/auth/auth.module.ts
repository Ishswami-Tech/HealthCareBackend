import { Module, forwardRef, Global } from "@nestjs/common";
import { AuthController } from "./controllers/auth.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { RedisModule } from "../../libs/infrastructure/cache/redis/redis.module";
import { EmailModule } from "../../libs/communication/messaging/email/email.module";
import { WhatsAppModule } from "../../libs/communication/messaging/whatsapp/whatsapp.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./services/auth.service";
import { SessionService } from "./services/session.service";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { ClinicModule } from '../clinic/clinic.module';
import { JwtModule } from '@nestjs/jwt';
import { EventsModule } from '../../libs/infrastructure/events/events.module';
import { LoggingModule } from '../../libs/infrastructure/logging/logging.module';
import { jwtConfig } from '../../config/jwt.config';
import { PermissionsModule } from '../../libs/infrastructure/permissions';

@Global()
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    EmailModule,
    WhatsAppModule,
    UsersModule,
    GuardsModule,
    RateLimitModule,
    forwardRef(() => ClinicModule),
    EventsModule,
    LoggingModule,
    JwtModule.register(jwtConfig),
    PermissionsModule
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService, JwtModule],
})
export class AuthModule {} 