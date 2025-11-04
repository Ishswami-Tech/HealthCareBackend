// External imports
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Internal imports - Infrastructure
import { LoggingModule } from '@infrastructure/logging';
import { RedisService } from '@infrastructure/cache/redis/redis.service';

@Global()
@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
