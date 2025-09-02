import { Module } from '@nestjs/common';
import { AppointmentQueueProcessor } from './appointment-queue.processor';
import { PrismaModule } from 'src/libs/infrastructure/database/prisma/prisma.module';
import { SocketModule } from 'src/libs/communication/socket/socket.module';

@Module({
  imports: [
    PrismaModule,
    SocketModule,
  ],
  providers: [AppointmentQueueProcessor],
  exports: [AppointmentQueueProcessor],
})
export class AppointmentProcessorModule {} 