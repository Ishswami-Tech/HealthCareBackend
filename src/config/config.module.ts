import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';
import redisConfig from './redis.config';
import rateLimitConfig from './rate-limit.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [
        process.env.NODE_ENV === 'production' 
          ? productionConfig 
          : developmentConfig,
        redisConfig,
        rateLimitConfig
      ],
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env'
      ],
    }),
  ],
})
export class ConfigModule {} 