/**
 * Soft Delete Helper
 * ==================
 * Provides reusable soft-delete operations for Prisma models that have a
 * `deletedAt` column. All methods filter out soft-deleted records automatically.
 *
 * Models with soft delete support:
 *   User, Clinic, ClinicLocation, FamilyMember, Supplier, WhatsAppSuppressionList,
 *   EmergencyContact
 *
 * Usage from service classes:
 *   const result = await this.softDelete.softDelete(this.prisma, 'user', userId);
 *   const count = await this.softDelete.countActive(this.prisma, 'clinic', clinicId);
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '../database.service';

type SoftDeletableModel =
  | 'user'
  | 'clinic'
  | 'clinicLocation'
  | 'familyMember'
  | 'supplier'
  | 'whatsAppSuppressionList'
  | 'emergencyContact';

@Injectable()
export class SoftDeleteHelper {
  private readonly softDeletableModels: Record<string, boolean> = {
    user: true,
    clinic: true,
    clinicLocation: true,
    familyMember: true,
    supplier: true,
    whatsAppSuppressionList: true,
    emergencyContact: true,
  };

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Soft-delete a record by setting `deletedAt` to now.
   * Returns the soft-deleted record.
   */
  async softDelete(
    model: SoftDeletableModel,
    where: { id: string }
  ): Promise<{ id: string } | null> {
    if (!this.softDeletableModels[model]) {
      throw new Error(`Soft delete not supported for model: ${model}`);
    }

    try {
      return await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as Record<
            string,
            {
              update: (args: {
                where: { id: string };
                data: { deletedAt: Date };
              }) => Promise<{ id: string }>;
            }
          >;
          return await (
            typedClient[model] as {
              update: (args: {
                where: { id: string };
                data: { deletedAt: Date };
              }) => Promise<{ id: string }>;
            }
          ).update({
            where: { id: where.id },
            data: { deletedAt: new Date() },
          });
        },
        {
          userId: 'system',
          userRole: 'system',
          clinicId: '',
          operation: 'SOFT_DELETE',
          resourceType: model.toUpperCase(),
          resourceId: where.id,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      void this.loggingService?.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Soft delete failed for ${model}:${where.id}`,
        'SoftDeleteHelper',
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Restore a soft-deleted record by clearing `deletedAt`.
   */
  async restore(model: SoftDeletableModel, where: { id: string }): Promise<{ id: string } | null> {
    if (!this.softDeletableModels[model]) {
      throw new Error(`Soft delete not supported for model: ${model}`);
    }

    try {
      return await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as Record<
            string,
            {
              update: (args: {
                where: { id: string };
                data: { deletedAt: Date | null };
              }) => Promise<{ id: string }>;
            }
          >;
          return await (
            typedClient[model] as {
              update: (args: {
                where: { id: string };
                data: { deletedAt: Date | null };
              }) => Promise<{ id: string }>;
            }
          ).update({
            where: { id: where.id },
            data: { deletedAt: null },
          });
        },
        {
          userId: 'system',
          userRole: 'system',
          clinicId: '',
          operation: 'RESTORE',
          resourceType: model.toUpperCase(),
          resourceId: where.id,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      void this.loggingService?.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Restore failed for ${model}:${where.id}`,
        'SoftDeleteHelper',
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Permanently delete a record (hard delete). Use with caution — bypasses
   * soft delete and triggers cascading deletes per Prisma schema.
   */
  async permanentDelete(
    model: SoftDeletableModel,
    where: { id: string }
  ): Promise<{ id: string } | null> {
    try {
      return await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as Record<
            string,
            {
              delete: (args: { where: { id: string } }) => Promise<{ id: string }>;
            }
          >;
          return await (
            typedClient[model] as {
              delete: (args: { where: { id: string } }) => Promise<{ id: string }>;
            }
          ).delete({ where: { id: where.id } });
        },
        {
          userId: 'system',
          userRole: 'system',
          clinicId: '',
          operation: 'PERMANENT_DELETE',
          resourceType: model.toUpperCase(),
          resourceId: where.id,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      void this.loggingService?.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Permanent delete failed for ${model}:${where.id}`,
        'SoftDeleteHelper',
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }
}
