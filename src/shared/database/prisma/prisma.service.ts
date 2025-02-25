import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private configService: ConfigService) {
    const isDevelopment = configService.get('NODE_ENV') === 'development';
    
    super({
      datasources: {
        db: {
          url: isDevelopment 
            ? configService.get('database.url')
            : configService.get('database.urlProd')
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
