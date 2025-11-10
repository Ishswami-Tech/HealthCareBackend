import { Injectable, Inject } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseSocket } from '@communication/socket/base-socket';
import { SocketService } from '@communication/socket/socket.service';
import { SocketAuthMiddleware } from '@communication/socket/socket-auth.middleware';
import { LoggingService } from '@infrastructure/logging';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class AppGateway extends BaseSocket {
  constructor(
    @Inject('SOCKET_SERVICE') socketService: SocketService,
    @Inject('SOCKET_AUTH_MIDDLEWARE') authMiddleware: SocketAuthMiddleware,
    @Inject(LoggingService) loggingService: LoggingService
  ) {
    super(socketService, 'AppGateway', authMiddleware, loggingService);
  }
}
