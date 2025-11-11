import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { LoggingModule } from '@infrastructure/logging';
import { ConfigModule, ConfigService } from '@config';
import { SocketService } from '@communication/socket/socket.service';
import { AppGateway } from '@communication/socket/app.gateway';
import { EventSocketBroadcaster } from '@communication/socket/event-socket.broadcaster';
import { SocketAuthMiddleware } from '@communication/socket/socket-auth.middleware';

@Global()
@Module({
  imports: [
    EventEmitterModule,
    LoggingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret:
          configService?.get<string>('JWT_SECRET') ||
          process.env['JWT_SECRET'] ||
          'default-secret-key',
        signOptions: { expiresIn: '7d' },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    SocketService,
    AppGateway,
    EventSocketBroadcaster,
    SocketAuthMiddleware,
    {
      provide: 'SOCKET_SERVICE',
      useFactory: (socketService: SocketService) => {
        return socketService;
      },
      inject: [SocketService],
    },
    {
      provide: 'SOCKET_AUTH_MIDDLEWARE',
      useFactory: (authMiddleware: SocketAuthMiddleware) => {
        return authMiddleware;
      },
      inject: [SocketAuthMiddleware],
    },
    {
      provide: 'WEBSOCKET_SERVER',
      useFactory: () => {
        return null; // Will be set by the gateway
      },
    },
  ],
  exports: [
    SocketService,
    'SOCKET_SERVICE',
    AppGateway,
    'WEBSOCKET_SERVER',
    EventSocketBroadcaster,
    SocketAuthMiddleware,
    'SOCKET_AUTH_MIDDLEWARE',
  ],
})
export class SocketModule {}
