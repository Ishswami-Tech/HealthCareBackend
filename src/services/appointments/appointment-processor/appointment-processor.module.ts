import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AppointmentQueueProcessor } from './appointment-queue.processor';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { SocketModule } from '../../../shared/socket/socket.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'appointment-queue',
      defaultJobOptions: {
        removeOnComplete: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    }),
    PrismaModule,
    SocketModule,
  ],
  providers: [AppointmentQueueProcessor],
  exports: [AppointmentQueueProcessor],
})
export class AppointmentProcessorModule {} 