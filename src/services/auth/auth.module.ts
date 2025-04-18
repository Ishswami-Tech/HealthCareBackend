import { Module } from "@nestjs/common";
import { AuthController } from "./controllers/auth.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { EmailModule } from "../../shared/messaging/email/email.module";
import { WhatsAppModule } from "../../shared/messaging/whatsapp/whatsapp.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./services/auth.service";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { ClinicModule } from '../clinic/clinic.module';
import { SharedModule } from '../../shared/shared.module';
import { JwtModule } from '@nestjs/jwt';
import { LoggingModule } from '../../shared/logging/logging.module';
import { EventsModule } from '../../shared/events/events.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    EmailModule,
    WhatsAppModule,
    UsersModule,
    GuardsModule,
    RateLimitModule,
    ClinicModule,
    SharedModule,
    LoggingModule,
    EventsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    })
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {} 