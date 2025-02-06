import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisCacheModule } from '../cache/cache.module';
import { KafkaModule } from '../kafka/kafka.module';

@Module({
  imports: [PrismaModule, RedisCacheModule, KafkaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
