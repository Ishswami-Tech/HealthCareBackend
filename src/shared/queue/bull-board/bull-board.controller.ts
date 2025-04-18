import { Controller, Get, Inject, All, HttpCode, UseGuards } from '@nestjs/common';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { createBullBoard } from '@bull-board/api';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { FastifyAdapter } from '@bull-board/fastify';

// You can create a proper admin guard
class AdminGuard {
  canActivate() {
    return true; // Implement proper authentication here
  }
}

@Controller('admin/queues')
export class BullBoardController {
  constructor(
    @InjectQueue('appointment-queue') private appointmentQueue: Queue,
    @InjectQueue('service-queue') private serviceQueue: Queue,
    @Inject('BULL_BOARD') private bullBoard: { serverAdapter: FastifyAdapter }
  ) {
    // Create the bull board with the queues
    createBullBoard({
      queues: [
        new BullAdapter(appointmentQueue),
        new BullAdapter(serviceQueue)
      ],
      serverAdapter: this.bullBoard.serverAdapter
    });
  }

  // These routes will be handled by the FastifyAdapter at the application level
  // but we need to define them to ensure NestJS creates the routes
  @Get()
  @UseGuards(AdminGuard)
  @HttpCode(200)
  public root() {
    return { status: 'ok' };
  }
  
  @All('*')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  public handleAll() {
    return { status: 'ok' };
  }
} 