#!/usr/bin/env node

/**
 * DEDICATED WORKER BOOTSTRAP
 * ==========================
 * High-performance worker process for 100,000+ concurrent users
 * Runs SharedWorkerService in a separate container for:
 * - Better resource isolation
 * - Independent scaling
 * - Optimized queue processing
 */

import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DatabaseModule } from "./libs/infrastructure/database";
import { CacheModule } from "./libs/infrastructure/cache/cache.module";
import { QueueModule } from "./libs/infrastructure/queue/src/queue.module";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === "production"
          ? ".env.production"
          : ".env.development",
      load: [configuration],
      expandVariables: true,
      cache: true,
    }),
    DatabaseModule,
    CacheModule,
    QueueModule.forRoot(),
  ],
  providers: [],
  exports: [],
})
class WorkerModule {}

async function bootstrap() {
  try {
    console.log(
      "🚀 Starting Healthcare Worker for High-Concurrency Queue Processing...",
    );

    const app = await NestFactory.create(WorkerModule, {
      logger: ["error", "warn", "log"],
    });

    const configService = app.get(ConfigService);

    // The SharedWorkerService is provided by QueueModule when SERVICE_NAME=worker
    // Since it's created in QueueModule.forRoot(), we don't need to access it directly
    console.log("SharedWorkerService will be initialized by QueueModule");

    // Initialize worker service
    await app.init();

    console.log(`✅ Healthcare Worker initialized successfully`);
    console.log(
      `🔄 Processing queues for ${configService.get("SERVICE_NAME", "clinic")} domain`,
    );
    console.log(
      `📊 Redis Connection: ${configService.get("REDIS_HOST", "localhost")}:${configService.get("REDIS_PORT", 6379)}`,
    );

    // Graceful shutdown handlers
    process.on("SIGTERM", () => {
      console.log("📤 Received SIGTERM, shutting down worker gracefully...");
      app
        .close()
        .then(() => {
          process.exit(0);
        })
        .catch((_error) => {
          console.error("❌ Error during SIGTERM shutdown:", _error);
          process.exit(1);
        });
    });

    process.on("SIGINT", () => {
      console.log("📤 Received SIGINT, shutting down worker gracefully...");
      app
        .close()
        .then(() => {
          process.exit(0);
        })
        .catch((_error) => {
          console.error("❌ Error during SIGINT shutdown:", _error);
          process.exit(1);
        });
    });

    // Health check endpoint for Docker
    if (process.argv.includes("--healthcheck")) {
      console.log("✅ Worker health check passed");
      process.exit(0);
    }

    // Keep the process alive
    console.log("🔄 Worker is running and processing queues...");
  } catch (_error) {
    console.error("❌ Worker failed to start:", _error);
    process.exit(1);
  }
}

// Handle unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (_error) => {
  console.error("🚨 Uncaught Exception:", _error);
  process.exit(1);
});

bootstrap().catch((_error) => {
  console.error("🚨 Bootstrap failed:", _error);
  process.exit(1);
});
