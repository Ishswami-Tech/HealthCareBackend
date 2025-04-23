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

@Module({
  imports: [
    SharedModule,
    PrismaModule,
    SocketModule,
    QueueModule.register(),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
  ],
  providers: [AppointmentSocket],
  exports: [AppointmentSocket],
})
export class AppointmentSocketModule {} 