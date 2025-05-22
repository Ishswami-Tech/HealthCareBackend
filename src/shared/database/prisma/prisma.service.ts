import { Injectable, OnModuleInit, OnModuleDestroy, Scope, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable({ scope: Scope.REQUEST })
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private currentTenantId: string | null = null;

  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL,
      log: ['error', 'warn'],
    });

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
      // Check if Prisma client already exists to avoid duplicate generation
      const clientPath = path.join(process.cwd(), 'node_modules', '.prisma', 'client');
      const clientExists = fs.existsSync(clientPath);
      
      if (clientExists) {
        this.logger.log('Prisma client already exists, skipping generation');
      }
      
      await this.$connect();
      this.logger.log('Connected to database successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Disconnected from database successfully');
    } catch (error) {
      this.logger.error('Error disconnecting from database:', error);
    }
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
