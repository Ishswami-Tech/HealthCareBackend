import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis/redis.service';
import { CacheController } from './controllers/cache.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [CacheController],
  providers: [RedisService],
  exports: [RedisService],
})
export class CacheModule {} 