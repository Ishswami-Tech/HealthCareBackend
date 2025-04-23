import { Module, forwardRef } from "@nestjs/common";
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
import { JwtModule } from '@nestjs/jwt';
import { EventsModule } from '../../shared/events/events.module';
import { LoggingModule } from '../../shared/logging/logging.module';

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