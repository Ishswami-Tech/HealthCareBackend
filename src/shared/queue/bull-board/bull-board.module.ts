import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RouterModule } from '@nestjs/core';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardController } from './bull-board.controller';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'appointment-queue' },
      { name: 'service-queue' }
    ),
  ],
  controllers: [BullBoardController],
  providers: [
    {
      provide: 'BULL_BOARD',
      useFactory: () => {
        const serverAdapter = new FastifyAdapter();
        
        // Don't call setBasePath here, we'll do it in main.ts
        
        return {
          serverAdapter
        };
      }
    }
  ],
  exports: ['BULL_BOARD'],
})
export class BullBoardModule {} 