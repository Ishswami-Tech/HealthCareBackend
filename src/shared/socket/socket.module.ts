import { Global, Module } from '@nestjs/common';
import { SocketService } from './socket.service';

@Global()
@Module({
  imports: [],
  providers: [
    SocketService,
    {
      provide: 'SOCKET_SERVICE',
      useFactory: (socketService: SocketService) => {
        return socketService;
      },
      inject: [SocketService],
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
    'WEBSOCKET_SERVER',
  ],
})
export class SocketModule {} 