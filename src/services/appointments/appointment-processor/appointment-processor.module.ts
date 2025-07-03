import { Module } from '@nestjs/common';
import { AppointmentQueueProcessor } from './appointment-queue.processor';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { SocketModule } from '../../../shared/socket/socket.module';

@Module({
  imports: [
    PrismaModule,
    SocketModule,
  ],
  providers: [AppointmentQueueProcessor],
  exports: [AppointmentQueueProcessor],
})
export class AppointmentProcessorModule {} 