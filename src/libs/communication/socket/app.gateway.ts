import { Injectable } from '@nestjs/common';
import { BaseSocket } from '@communication/socket/base-socket';
import { SocketService } from '@communication/socket/socket.service';
import { SocketAuthMiddleware } from '@communication/socket/socket-auth.middleware';
import { LoggingService } from '@infrastructure/logging';

@Injectable()
export class AppGateway extends BaseSocket {
  constructor(
    socketService: SocketService,
    authMiddleware: SocketAuthMiddleware,
    loggingService: LoggingService
  ) {
    super(socketService, 'AppGateway', authMiddleware, loggingService);
  }
}
