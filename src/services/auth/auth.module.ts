import { Module } from "@nestjs/common";
import { AuthController } from "./controllers/auth.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { KafkaModule } from "../../shared/messaging/kafka/kafka.module";
import { EmailModule } from "../../shared/messaging/email/email.module";
import { WhatsAppModule } from "../../shared/messaging/whatsapp/whatsapp.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./services/auth.service";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { ClinicModule } from '../clinic/clinic.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    KafkaModule,
    EmailModule,
    WhatsAppModule,
    UsersModule,
    GuardsModule,
    RateLimitModule,
    ClinicModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {} 