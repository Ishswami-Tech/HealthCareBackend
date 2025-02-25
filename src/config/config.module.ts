import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      load: [
        process.env.NODE_ENV === 'production' 
          ? productionConfig 
          : developmentConfig
      ],
      isGlobal: true,
    }),
  ],
})
export class ConfigModule {} 