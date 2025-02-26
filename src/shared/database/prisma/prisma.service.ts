import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getPrismaClient } from './prisma.types';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private prisma = getPrismaClient();

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  get client() {
    return this.prisma;
  }
}
