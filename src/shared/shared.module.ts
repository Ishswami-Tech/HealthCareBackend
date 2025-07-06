import { Module } from '@nestjs/common';
import { PrismaModule } from './database/prisma/prisma.module';
import { LoggingModule } from './logging/logging.module';
import { CacheModule } from './cache/cache.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { QrModule } from './QR/qr.module';
import { SocketModule } from './socket/socket.module';
import { TenantContextInterceptor } from './interceptors/tenant-context.interceptor';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    CacheModule,
    RateLimitModule,
    QrModule,
    SocketModule,
  ],
  providers: [
    TenantContextInterceptor,
  ],
  exports: [
    PrismaModule,
    LoggingModule,
    CacheModule,
    RateLimitModule,
    QrModule,
    SocketModule,
    TenantContextInterceptor,
  ],
})
export class SharedModule {} 