import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module";
import { UsersModule } from "./services/users/users.module";
import { PrismaModule } from "./shared/database/prisma/prisma.module";
import { CacheModule } from "./shared/cache/cache.module";
import { KafkaModule } from "./shared/messaging/kafka/kafka.module";
import { AppController } from "./app.controller";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CacheModule,
    KafkaModule,
    UsersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
