import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BullBoardModule as BullBoardNestModule } from '@bull-board/nestjs';
import { FastifyAdapter } from '@bull-board/fastify';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'appointment-queue' },
      { name: 'service-queue' }
    ),
    BullBoardNestModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        route: '/queue-dashboard',
        adapter: FastifyAdapter,
        auth: {
          user: config.get('QUEUE_DASHBOARD_USER', 'admin'),
          password: config.get('QUEUE_DASHBOARD_PASSWORD', 'admin')
        },
        basePath: '/queue-dashboard',
        middleware: (req, res, next) => {
          // Only handle queue-dashboard routes
          if (req.url.startsWith('/queue-dashboard')) {
            next();
          } else {
            // Pass through for non-queue routes
            next('route');
          }
        }
      }),
      inject: [ConfigService]
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
export class BullBoardModule {
  configure(consumer: MiddlewareConsumer) {
    // Only apply Bull Board middleware to queue-dashboard routes
    consumer
      .apply()
      .forRoutes(
        { path: 'queue-dashboard', method: RequestMethod.ALL },
        { path: 'queue-dashboard/*', method: RequestMethod.ALL }
      );
  }
} 