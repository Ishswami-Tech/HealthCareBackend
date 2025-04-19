import { Module } from '@nestjs/common';
import { AppointmentSocket } from './appointment.socket';
import { SharedModule } from '../../../shared/shared.module';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { SocketModule } from '../../../shared/socket/socket.module';

@Module({
  imports: [
    SharedModule,
    PrismaModule,
    SocketModule,
  ],
  providers: [AppointmentSocket],
  exports: [AppointmentSocket],
})
export class AppointmentSocketModule {} 