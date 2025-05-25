import { Injectable } from '@nestjs/common';
import { BaseSocket } from './base-socket';
import { SocketService } from './socket.service';

@Injectable()
export class AppGateway extends BaseSocket {
  constructor(socketService: SocketService) {
    super(socketService, 'AppGateway');
  }
} 