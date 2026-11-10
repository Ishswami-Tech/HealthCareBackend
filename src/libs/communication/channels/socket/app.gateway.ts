import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseSocket } from '@communication/channels/socket/base-socket';
import { SocketService } from '@communication/channels/socket/socket.service';
import { SocketAuthMiddleware } from '@communication/channels/socket/socket-auth.middleware';
import { getSocketCorsOrigin } from '@communication/channels/socket/socket-cors.util';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: getSocketCorsOrigin(),
    credentials: true,
  },
  // Must match main.ts's server-level transports (websocket-only: no sticky-session
  // routing across replicas - see the comment there for why).
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 60000,
})
export class AppGateway extends BaseSocket {
  constructor(
    @Inject('SOCKET_SERVICE') socketService: SocketService,
    @Inject('SOCKET_AUTH_MIDDLEWARE') authMiddleware: SocketAuthMiddleware,
    @Optional() @Inject(forwardRef(() => LoggingService)) loggingService?: LoggingService
  ) {
    super(socketService, 'AppGateway', authMiddleware, loggingService);
  }
}
