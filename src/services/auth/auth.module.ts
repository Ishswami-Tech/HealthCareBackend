import { Module, forwardRef, Global } from "@nestjs/common";
import { AuthController } from "./controllers/auth.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { EmailModule } from "../../shared/messaging/email/email.module";
import { WhatsAppModule } from "../../shared/messaging/whatsapp/whatsapp.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./services/auth.service";
import { SessionService } from "./services/session.service";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { ClinicModule } from '../clinic/clinic.module';
import { JwtModule } from '@nestjs/jwt';
import { EventsModule } from '../../shared/events/events.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { jwtConfig } from '../../config/jwt.config';

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
    JwtModule.register(jwtConfig)
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService, JwtModule],
})
export class AuthModule {} 