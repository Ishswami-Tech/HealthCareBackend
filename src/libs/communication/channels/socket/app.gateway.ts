import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { BaseSocket } from '@communication/channels/socket/base-socket';
import { SocketService } from '@communication/channels/socket/socket.service';
import { SocketAuthMiddleware } from '@communication/channels/socket/socket-auth.middleware';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';

// Get CORS origin from environment (fallback to restricted list for security)
const getCorsOrigin = (): string | string[] => {
  const corsOrigin = process.env['CORS_ORIGIN'] || '';
  if (corsOrigin) {
    // Split comma-separated origins
    return corsOrigin.split(',').map((o: string) => o.trim());
  }
  // Default to localhost origins only (more secure than '*')
  return [
    'http://localhost:3000',
    'http://localhost:8088',
    'http://localhost:5050',
    'http://localhost:8082',
  ];
};

@Injectable()
@WebSocketGateway({
  cors: {
    origin: getCorsOrigin(),
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
    @Optional() @Inject(forwardRef(() => LoggingService)) loggingService?: LoggingService
  ) {
    super(socketService, 'AppGateway', authMiddleware, loggingService);
  }
}
