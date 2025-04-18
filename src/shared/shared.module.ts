import { Module } from '@nestjs/common';
import { QrModule } from './QR/qr.module';
import { QueueModule } from './queue/queue.module';
import { SocketModule } from './socket/socket.module';
import { PrismaModule } from './database/prisma/prisma.module';
import { CacheModule } from './cache/cache.module';

@Module({
  imports: [
    QrModule,
    QueueModule.forRoot(),
    SocketModule,
    PrismaModule,
    CacheModule,
  ],
  exports: [
    QrModule,
    QueueModule,
    SocketModule,
    PrismaModule,
    CacheModule,
  ],
})
export class SharedModule {} 