import { Global, Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { LoggingModule } from '@logging';
import { ConfigModule, ConfigService } from '@config';
import { EventsModule } from '@infrastructure/events';
import { SocketService } from '@communication/channels/socket/socket.service';
import { AppGateway } from '@communication/channels/socket/app.gateway';
import { EventSocketBroadcaster } from '@communication/channels/socket/event-socket.broadcaster';
import { SocketAuthMiddleware } from '@communication/channels/socket/socket-auth.middleware';

@Global()
@Module({
  imports: [
    EventEmitterModule,
    LoggingModule,
    forwardRef(() => EventsModule), // Central event system for EventSocketBroadcaster
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
