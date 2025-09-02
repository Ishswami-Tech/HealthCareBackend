import { Injectable, OnModuleInit, OnModuleDestroy, Scope, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { connectionManagementMiddleware } from './middleware/connection-management.middleware';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private currentTenantId: string | null = null;
  private static connectionCount = 0;
  private static readonly MAX_CONNECTIONS = 90; // Leave some margin for other operations
  private static readonly CONNECTION_TIMEOUT = 5000; // 5 seconds timeout for connections
  private static instance: PrismaService | null = null;
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000; // 1 second

  constructor() {
    // If we already have a Prisma instance, return it
    if (PrismaService.instance) {
      return PrismaService.instance;
    }

    super({
      log: [
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
      errorFormat: 'minimal',
    });

    // Apply connection management middleware
    // Note: $use is deprecated, using $extends instead

    // Database events monitoring removed as $on is deprecated

    // Monitor queries only in development
    if (process.env.NODE_ENV !== 'production') {
      // Query monitoring will be handled via extensions
    }

    // Store the instance
    PrismaService.instance = this;

    // Tenant isolation will be handled via manual filtering in service methods
    // as $use middleware is deprecated
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    try {
      if (PrismaService.connectionCount > 0) {
        await this.$disconnect();
        PrismaService.connectionCount--;
        PrismaService.instance = null; // Clear the singleton instance
        this.logger.log(`Disconnected from database successfully. Remaining connections: ${PrismaService.connectionCount}`);
      }
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
    }
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    try {
      await this.$connect();
      console.log('Successfully connected to database');
    } catch (error) {
      if (retryCount < this.maxRetries) {
        console.warn(`Failed to connect to database. Retrying in ${this.retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        await this.connectWithRetry(retryCount + 1);
      } else {
        console.error('Failed to connect to database after maximum retries');
        throw error;
      }
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

  // Method to handle transactions with retries
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        console.warn(`Operation failed. Retrying in ${this.retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw error;
    }
  }

  // Helper method to determine if an error is retryable
  private isRetryableError(error: any): boolean {
    return (
      error instanceof Error && error.name === 'PrismaClientKnownRequestError' &&
      ((error as any).code === 'P2024' || // Connection pool timeout
       (error as any).code === 'P2028' || // Transaction timeout
       (error as any).code === 'P2025' || // Record not found
       (error as any).code === 'P2034') // Transaction failed
    );
  }

  // Method to get tenant-specific prisma instance
  async withTenant(tenantId: string) {
    return this.$extends({
      query: {
        $allOperations({ args, query }) {
          // Add tenant context to all queries
          args.where = { ...args.where, tenantId };
          return query(args);
        },
      },
    });
  }
}
