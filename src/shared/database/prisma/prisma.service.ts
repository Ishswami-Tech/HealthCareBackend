import { Injectable, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static clients: Map<string, PrismaClient> = new Map();
  private currentClient: PrismaClient;

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
    this.currentClient = this;
  }

  async onModuleInit() {
    await this.currentClient.$connect();
  }

  async onModuleDestroy() {
    await this.currentClient.$disconnect();
  }

  /**
   * Get a Prisma client for a specific clinic
   * @param clinicId The ID of the clinic
   * @returns A Prisma client connected to the clinic's database
   */
  async getClinicClient(clinicId: string): Promise<PrismaClient> {
    // If no clinic ID is provided, return the default client (global database)
    if (!clinicId) {
      return this;
    }

    // Check if we already have a client for this clinic
    if (PrismaService.clients.has(clinicId)) {
      this.currentClient = PrismaService.clients.get(clinicId);
      return this.currentClient;
    }

    // Get the clinic's database connection string from the global database
    const clinic = await this.$queryRaw<{ db_connection_string: string }[]>`
      SELECT db_connection_string FROM "Clinic" WHERE id = ${clinicId}
    `;

    if (!clinic || clinic.length === 0) {
      throw new Error(`Clinic with ID ${clinicId} not found`);
    }

    // Create a new Prisma client for the clinic
    const clinicClient = new PrismaClient({
      datasources: {
        db: {
          url: clinic[0].db_connection_string,
        },
      },
    });

    // Connect to the clinic's database
    await clinicClient.$connect();

    // Store the client for future use
    PrismaService.clients.set(clinicId, clinicClient);
    this.currentClient = clinicClient;

    return clinicClient;
  }

  /**
   * Close all clinic database connections
   */
  static async closeAllConnections() {
    for (const client of PrismaService.clients.values()) {
      await client.$disconnect();
    }
    PrismaService.clients.clear();
  }
}
