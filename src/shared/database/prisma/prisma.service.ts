import { Injectable, OnModuleInit, OnModuleDestroy, Scope, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static clients: Map<string, PrismaClient> = new Map();
  private currentClient: PrismaClient;
  private readonly logger = new Logger(PrismaService.name);
  private static maxConnections = 10; // Maximum connections per client

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: ['query', 'info', 'warn', 'error'],
    });
    this.currentClient = this;
  }

  async onModuleInit() {
    try {
      await this.currentClient.$connect();
      this.logger.log('Connected to database successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.currentClient.$disconnect();
      this.logger.log('Disconnected from database successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
    }
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

    // Check if we've reached the maximum number of connections
    if (PrismaService.clients.size >= PrismaService.maxConnections) {
      this.logger.warn('Maximum number of database connections reached. Cleaning up inactive connections...');
      await this.cleanupInactiveConnections();
    }

    try {
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
            url: `${clinic[0].db_connection_string}?connection_limit=5&pool_timeout=30`, // Configure connection pool at URL level
          },
        },
        log: ['query', 'info', 'warn', 'error'],
      });

      // Connect to the clinic's database
      await clinicClient.$connect();

      // Store the client for future use
      PrismaService.clients.set(clinicId, clinicClient);
      this.currentClient = clinicClient;

      return clinicClient;
    } catch (error) {
      this.logger.error(`Failed to create client for clinic ${clinicId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up inactive database connections
   */
  private async cleanupInactiveConnections(): Promise<void> {
    try {
      const promises: Promise<void>[] = [];
      
      // Disconnect clients that haven't been used recently
      for (const [clinicId, client] of PrismaService.clients.entries()) {
        promises.push(
          client.$disconnect()
            .then(() => {
              PrismaService.clients.delete(clinicId);
              this.logger.log(`Cleaned up connection for clinic ${clinicId}`);
            })
            .catch((error) => {
              this.logger.error(`Error cleaning up connection for clinic ${clinicId}:`, error);
            })
        );
      }

      await Promise.all(promises);
    } catch (error) {
      this.logger.error('Error during connection cleanup:', error);
    }
  }

  /**
   * Close all clinic database connections
   */
  static async closeAllConnections() {
    const promises: Promise<void>[] = [];
    for (const [clinicId, client] of PrismaService.clients.entries()) {
      promises.push(
        client.$disconnect()
          .then(() => {
            PrismaService.clients.delete(clinicId);
          })
          .catch((error) => {
            console.error(`Error disconnecting client for clinic ${clinicId}:`, error);
          })
      );
    }
    await Promise.all(promises);
    PrismaService.clients.clear();
  }
}
