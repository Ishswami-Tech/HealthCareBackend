import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    super({
      datasources: {
        db: {
          url: isDevelopment 
            ? process.env.DATABASE_URL 
            : process.env.DATABASE_URL_PROD
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Prisma connected successfully');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async cleanDatabase() {
    if (
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test'
    ) {
      // Add your cleanup logic here if needed
      return;
    }
  }
}
