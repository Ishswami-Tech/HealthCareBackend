import { Injectable, OnModuleInit, OnModuleDestroy, Scope, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Define global type for Prisma
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private currentTenantId: string | null = null;
  private static connectionCount = 0;
  private static readonly MAX_CONNECTIONS = 90; // Leave some margin for other operations
  private static readonly CONNECTION_TIMEOUT = 5000; // 5 seconds timeout for connections

  constructor() {
    // If we already have a Prisma instance, return it
    if (globalForPrisma.prisma) {
      return globalForPrisma.prisma as PrismaService;
    }

    super({
      datasourceUrl: process.env.DATABASE_URL,
      log: ['error', 'warn'],
      transactionOptions: {
        maxWait: 5000, // 5 seconds max wait time
        timeout: 5000, // 5 seconds timeout
      },
    });

    // Configure connection events
    this.$on('beforeExit', async () => {
      this.logger.log('Prisma Client beforeExit event');
    });

    // Handle query errors
    this.$use(async (params, next) => {
      try {
        return await next(params);
      } catch (error) {
        this.logger.error('Prisma query error:', error);
        throw error;
      }
    });

    // Store the instance globally in development
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = this;
    }

    // Add middleware to enforce tenant isolation
    this.$use(async (params, next) => {
      // Only apply tenant filter to models that have clinicId field
      const modelsWithTenantId = [
        'Appointment', 'ClinicLocation', 'ClinicAdmin', 'Therapy', 
        'Prescription', 'PrescriptionItem', 'Medicine', 'DoctorClinic',
        'Payment', 'Queue', 'HealthRecord', 'Review', 'Product'
      ];

      // Skip tenant isolation for admin operations and models without tenant fields
      if (!this.currentTenantId || !modelsWithTenantId.includes(params.model)) {
        return next(params);
      }

      // Add clinicId filter for read operations
      if (params.action === 'findUnique' || params.action === 'findFirst') {
        // Add tenant isolation condition to where clause
        if (params.args.where?.clinicId === undefined) {
          params.args.where = {
            ...params.args.where,
            clinicId: this.currentTenantId
          };
        }
      }
      
      // Add tenant filter for findMany
      if (params.action === 'findMany') {
        // Add tenant isolation condition to where clause
        if (!params.args) params.args = {};
        if (!params.args.where) params.args.where = {};
        
        if (params.args.where.clinicId === undefined) {
          params.args.where.clinicId = this.currentTenantId;
        }
      }
      
      // Add tenant ID for create operations
      if (params.action === 'create' || params.action === 'createMany') {
        if (params.args.data) {
          params.args.data = {
            ...params.args.data,
            clinicId: this.currentTenantId
          };
        }
      }
      
      // Add tenant check for update and delete operations
      if (params.action === 'update' || params.action === 'updateMany' || 
          params.action === 'delete' || params.action === 'deleteMany') {
        
        if (!params.args.where) params.args.where = {};
        
        if (params.args.where.clinicId === undefined) {
          params.args.where = {
            ...params.args.where,
            clinicId: this.currentTenantId
          };
        }
      }
      
      return next(params);
    });
  }

  async onModuleInit() {
    try {
      // Only connect if we haven't exceeded max connections
      if (PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS) {
        await this.connectWithTimeout();
        PrismaService.connectionCount++;
        this.logger.log(`Connected to database successfully. Active connections: ${PrismaService.connectionCount}`);
      } else {
        this.logger.warn(`Max connections (${PrismaService.MAX_CONNECTIONS}) reached. Reusing existing connection.`);
      }
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      if (PrismaService.connectionCount > 0) {
        await this.$disconnect();
        PrismaService.connectionCount--;
        this.logger.log(`Disconnected from database successfully. Remaining connections: ${PrismaService.connectionCount}`);
      }
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
    }
  }

  private async connectWithTimeout(): Promise<void> {
    try {
      await Promise.race([
        this.$connect(),
        new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Database connection timeout after ${PrismaService.CONNECTION_TIMEOUT}ms`));
          }, PrismaService.CONNECTION_TIMEOUT);
        }),
      ]);
    } catch (error) {
      this.logger.error('Connection timeout or error:', error);
      throw error;
    }
  }

  /**
   * Get the current connection count
   * @returns The number of active database connections
   */
  static getConnectionCount(): number {
    return PrismaService.connectionCount;
  }

  /**
   * Check if we can create a new connection
   * @returns boolean indicating if a new connection can be created
   */
  static canCreateNewConnection(): boolean {
    return PrismaService.connectionCount < PrismaService.MAX_CONNECTIONS;
  }

  /**
   * Set the current tenant ID for this request
   * This will be used to automatically filter all database queries
   * to only include data for this tenant
   * @param tenantId The ID of the tenant
   */
  setCurrentTenantId(tenantId: string | null) {
    if (tenantId) {
      this.logger.debug(`Setting current tenant ID to ${tenantId}`);
    } else {
      this.logger.debug('Clearing tenant ID - using global scope');
    }
    this.currentTenantId = tenantId;
  }

  /**
   * Get the current tenant ID
   * @returns The current tenant ID or null if not set
   */
  getCurrentTenantId(): string | null {
    return this.currentTenantId;
  }

  /**
   * Clear the current tenant ID
   * This is useful for operations that should access all data
   * For example, administrative tasks
   */
  clearTenantId() {
    this.currentTenantId = null;
  }

  /**
   * Get a client instance for the specified clinic
   * Note: This is just a wrapper that sets the tenant context, not an actual separate connection
   * @param clinicId The ID of the clinic
   * @returns The Prisma client with tenant context set
   */
  async getClinicClient(clinicId: string): Promise<PrismaService> {
    // Set the tenant context
    this.setCurrentTenantId(clinicId);
    return this;
  }
}
