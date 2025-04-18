import { Module } from '@nestjs/common';
import { AppointmentSocket } from './appointment.socket';
import { QueueModule } from '../../../shared/queue/queue.module';
import { SocketModule } from '../../../shared/socket/socket.module';

@Module({
  imports: [
    QueueModule.register('appointment-queue'),
    SocketModule,
  ],
  providers: [AppointmentSocket],
  exports: [AppointmentSocket],
})
export class AppointmentSocketModule {} 