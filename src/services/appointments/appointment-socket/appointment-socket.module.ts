import { Module } from '@nestjs/common';
import { AppointmentSocket } from './appointment.socket';
import { SharedModule } from '../../../shared/shared.module';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { SocketModule } from '../../../shared/socket/socket.module';
import { QueueModule } from '../../../shared/queue/queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../../shared/rate-limit/rate-limit.module';
import { GuardsModule } from '../../../libs/guards/guards.module';
import { AppointmentQueueModule } from '../appointment-queue/appointment-queue.module';
import { AppointmentService } from '../appointments.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

@Module({
  imports: [
    SharedModule,
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
    BullModule.registerQueue({
      name: 'appointment-queue',
      defaultJobOptions: {
        removeOnComplete: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
    AppointmentQueueModule,
    ConfigModule,
  ],
  providers: [
    AppointmentSocket,
    AppointmentService,
  ],
  exports: [AppointmentSocket],
})
export class AppointmentSocketModule {} 