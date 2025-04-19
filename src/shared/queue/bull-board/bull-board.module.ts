import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule as BullBoardNestModule } from '@bull-board/nestjs';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullAdapter } from '@bull-board/api/bullAdapter';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'appointment-queue' },
      { name: 'service-queue' }
    ),
    BullBoardNestModule.forRoot({
      route: '/admin/queues',
      adapter: FastifyAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: 'appointment-queue',
      adapter: BullAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: 'service-queue',
      adapter: BullAdapter,
    }),
  ],
})
export class BullBoardModule {} 