import { Module, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { BullBoardModule as BullBoardNestModule } from "@bull-board/nestjs";
import { FastifyAdapter } from "@bull-board/fastify";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BullBoardService } from "./bull-board.service";
import {
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
} from "../queue.constants";
import { Queue } from "bullmq";

@Module({
  providers: [BullBoardService],
  exports: [BullBoardService],
  imports: [
    BullBoardNestModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        route: "/queue-dashboard",
        adapter: FastifyAdapter,
        auth: {
          user: config.get("QUEUE_DASHBOARD_USER", "admin"),
          password: config.get("QUEUE_DASHBOARD_PASSWORD", "admin"),
        },
        basePath: "/queue-dashboard",
        middleware: (req: any, res: any, next: any) => {
          // Only handle queue-dashboard routes
          if (req.url.startsWith("/queue-dashboard")) {
            next();
          } else {
            // Pass through for non-queue routes
            next("route");
          }
        },
      }),
      inject: [ConfigService],
    }),
    BullBoardNestModule.forFeature({
      name: SERVICE_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: APPOINTMENT_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: EMAIL_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: NOTIFICATION_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: VIDHAKARMA_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: PANCHAKARMA_QUEUE,
      adapter: BullMQAdapter,
    }),
    BullBoardNestModule.forFeature({
      name: CHEQUP_QUEUE,
      adapter: BullMQAdapter,
    }),
  ],
})
export class BullBoardModule {
  configure(consumer: MiddlewareConsumer) {
    // Only apply Bull Board middleware to queue-dashboard routes
    consumer
      .apply()
      .forRoutes(
        { path: "queue-dashboard", method: RequestMethod.ALL },
        { path: "queue-dashboard/*", method: RequestMethod.ALL },
      );
  }
}

// IMPORTANT: Secure Bull Board in production!
// Example: Use strong authentication and restrict by IP
// See: https://docs.nestjs.com/techniques/queues#monitoring-queues-with-bull-board
