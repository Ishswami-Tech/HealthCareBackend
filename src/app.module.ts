import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";
import { RedisModule } from "./redis/redis.module";
import { KafkaModule } from "./kafka/kafka.module";

@Module({
  imports: [PrismaModule, UsersModule, RedisModule, KafkaModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
