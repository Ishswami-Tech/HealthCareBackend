import { Module } from '@nestjs/common';
import { AppointmentSocket } from './appointment.socket';
import { PrismaModule } from '../../../libs/infrastructure/database/prisma/prisma.module';
import { SocketModule } from '../../../libs/communication/socket/socket.module';
import { QueueModule } from '../../../libs/infrastructure/queue/queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../../libs/infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../../libs/utils/rate-limit/rate-limit.module';
import { GuardsModule } from '../../../libs/core/guards/guards.module';
import { AppointmentQueueModule } from '../appointment-queue/appointment-queue.module';
import { AppointmentService } from '../appointments.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QrModule } from '../../../libs/utils/QR/qr.module';
import { LoggingModule } from '../../../libs/infrastructure/logging/logging.module';

@Module({
  imports: [
    PrismaModule,
    SocketModule,
    QueueModule.register(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { 
          expiresIn: configService.get('JWT_EXPIRATION', '24h') 
        },
      }),
      inject: [ConfigService],
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
    AppointmentQueueModule,
    ConfigModule,
    QrModule,
    LoggingModule,
  ],
  providers: [
    AppointmentSocket,
    AppointmentService,
  ],
  exports: [AppointmentSocket],
})
export class AppointmentSocketModule {} 