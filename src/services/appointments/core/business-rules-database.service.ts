import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

import type { BusinessRule } from '@core/types/appointment.types';

// Use BusinessRule from centralized types, alias as BusinessRuleEntity for backward compatibility
export type BusinessRuleEntity = BusinessRule;

@Injectable()
export class BusinessRulesDatabaseService {
  private readonly RULES_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Create business rule
   */
  async createRule(
    ruleData: Omit<BusinessRuleEntity, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<BusinessRuleEntity> {
    try {
      // Use executeHealthcareWrite with client parameter (businessRule model doesn't have safe method yet)
      const rule = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              businessRule: {
                create: <T>(args: T) => Promise<BusinessRuleEntity>;
              };
            }
          ).businessRule.create({
            data: {
              name: ruleData.name,
              description: ruleData.description,
              priority: ruleData.priority,
              isActive: ruleData.isActive,
              category: ruleData.category,
              version: ruleData.version,
              tags: ruleData.tags,
              conditions: ruleData.conditions,
              actions: ruleData.actions,
              clinicId: ruleData.clinicId,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: ruleData.clinicId || '',
          resourceType: 'BUSINESS_RULE',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { ruleName: ruleData.name },
        }
      );

      // Cache the rule

      const cacheKey = `business_rule:${rule.id}`;
      await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);

      // Invalidate rules cache
      await this.invalidateRulesCache(ruleData.clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Created business rule ${(rule as { id: string }).id}`,
        'BusinessRulesDatabaseService.createRule',
        {
          ruleId: (rule as { id: string }).id,
          name: ruleData.name,
          clinicId: ruleData.clinicId,
          priority: ruleData.priority,
        }
      );

      return rule;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create business rule: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.createRule',
        {
          ruleName: ruleData.name,
          clinicId: ruleData.clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Get rules for clinic
   */
  async getClinicRules(clinicId?: string): Promise<BusinessRuleEntity[]> {
    const cacheKey = `clinic_rules:${clinicId || 'global'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as BusinessRuleEntity[];
      }

      // Use executeHealthcareRead with client parameter (businessRule model doesn't have safe method yet)
      const rules = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            businessRule: {
              findMany: <T>(args: T) => Promise<BusinessRuleEntity[]>;
            };
          }
        ).businessRule.findMany({
          where: {
            isActive: true,
            OR: [
              { clinicId: clinicId },
              { clinicId: null }, // Global rules
            ],
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        } as never);
      });

      await this.cacheService.set(cacheKey, rules, this.RULES_CACHE_TTL);
      return rules;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get clinic rules: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.getClinicRules',
        {
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Update business rule
   */
  async updateRule(
    ruleId: string,
    updateData: Partial<BusinessRuleEntity>
  ): Promise<BusinessRuleEntity> {
    try {
      // Use executeHealthcareWrite with client parameter
      const rule = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              businessRule: {
                update: <T>(args: T) => Promise<BusinessRuleEntity>;
              };
            }
          ).businessRule.update({
            where: { id: ruleId },
            data: {
              ...(updateData.name && { name: updateData.name }),
              ...(updateData.description && { description: updateData.description }),
              ...(updateData.priority !== undefined && { priority: updateData.priority }),
              ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
              ...(updateData.category && { category: updateData.category }),
              ...(updateData.version && { version: updateData.version }),
              ...(updateData.tags && { tags: updateData.tags }),
              ...(updateData.conditions && { conditions: updateData.conditions }),
              ...(updateData.actions && { actions: updateData.actions }),
              ...(updateData.clinicId !== undefined && { clinicId: updateData.clinicId }),
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: (updateData as { clinicId?: string }).clinicId || '',
          resourceType: 'BUSINESS_RULE',
          operation: 'UPDATE',
          resourceId: ruleId,
          userRole: 'system',
          details: { updates: Object.keys(updateData) },
        }
      );

      // Update cache
      const cacheKey = `business_rule:${ruleId}`;
      await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);

      // Invalidate rules cache
      await this.invalidateRulesCache((rule as { clinicId?: string }).clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Updated business rule ${ruleId}`,
        'BusinessRulesDatabaseService.updateRule',
        {
          ruleId,
          updates: Object.keys(updateData),
        }
      );

      return rule;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update business rule: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.updateRule',
        {
          ruleId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Delete business rule
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    try {
      // Use executeHealthcareWrite with client parameter
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              businessRule: {
                delete: <T>(args: T) => Promise<BusinessRuleEntity>;
              };
            }
          ).businessRule.delete({
            where: { id: ruleId },
          } as never);
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'BUSINESS_RULE',
          operation: 'DELETE',
          resourceId: ruleId,
          userRole: 'system',
          details: {},
        }
      );

      // Remove from cache
      const cacheKey = `business_rule:${ruleId}`;
      await this.cacheService.delete(cacheKey);

      // Invalidate rules cache
      await this.invalidateRulesCache();

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Deleted business rule ${ruleId}`,
        'BusinessRulesDatabaseService.deleteRule',
        { ruleId }
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to delete business rule: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.deleteRule',
        {
          ruleId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Get rule by ID
   */
  async getRule(ruleId: string): Promise<BusinessRuleEntity | null> {
    const cacheKey = `business_rule:${ruleId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as BusinessRuleEntity;
      }

      // Use executeHealthcareRead with client parameter
      const rule = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            businessRule: {
              findUnique: <T>(args: T) => Promise<BusinessRuleEntity | null>;
            };
          }
        ).businessRule.findUnique({
          where: { id: ruleId },
        } as never);
      });

      if (rule) {
        await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);
      }

      return rule;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get business rule: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.getRule',
        {
          ruleId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Initialize default business rules
   */
  async initializeDefaultRules(): Promise<void> {
    try {
      const defaultRules: Array<Omit<BusinessRuleEntity, 'id' | 'createdAt' | 'updatedAt'>> = [
        {
          name: 'appointment-time-validation',
          description: 'Appointment must be during working hours',
          priority: 1,
          isActive: true,
          category: 'appointment_creation',
          version: '1.0.0',
          tags: [],
          conditions: [
            {
              type: 'custom',
              field: 'time_validation',
              value: { workingHours: { start: '09:00', end: '18:00' } },
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            { type: 'notify', message: 'Time validation required', severity: 'medium' },
            { type: 'log', message: 'Working hours check', severity: 'low' },
          ] as readonly import('@core/types').RuleAction[],
        },
        {
          name: 'double-booking-prevention',
          description: 'Doctor cannot have overlapping appointments',
          priority: 2,
          isActive: true,
          category: 'appointment_creation',
          version: '1.0.0',
          tags: [],
          conditions: [
            {
              type: 'custom',
              field: 'conflict_check',
              value: { bufferMinutes: 15 },
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            { type: 'block', message: 'Double booking detected', severity: 'high' },
            { type: 'notify', message: 'Suggest alternatives', severity: 'medium' },
          ] as readonly import('@core/types').RuleAction[],
        },
        {
          name: 'emergency-override',
          description: 'Emergency appointments can override conflicts',
          priority: 0,
          isActive: true,
          category: 'appointment_creation',
          version: '1.0.0',
          tags: [],
          conditions: [
            {
              type: 'custom',
              field: 'priority_check',
              value: { priority: 'emergency' },
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            { type: 'allow', message: 'Emergency override', severity: 'low' },
            { type: 'notify', message: 'Emergency appointment', severity: 'high' },
          ] as readonly import('@core/types').RuleAction[],
        },
      ];

      for (const ruleData of defaultRules) {
        // Use executeHealthcareRead with client parameter
        const existing = await this.databaseService.executeHealthcareRead(async client => {
          return await (
            client as unknown as {
              businessRule: {
                findFirst: <T>(args: T) => Promise<BusinessRuleEntity | null>;
              };
            }
          ).businessRule.findFirst({
            where: { name: ruleData.name },
          } as never);
        });

        if (!existing) {
          // Filter out undefined clinicId for global rules
          const { clinicId, ...ruleDataWithoutClinicId } = ruleData;
          const ruleToCreate = clinicId ? ruleData : ruleDataWithoutClinicId;
          await this.createRule(ruleToCreate);
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Initialized default business rules',
        'BusinessRulesDatabaseService.initializeDefaultRules'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize default business rules: ${error instanceof Error ? error.message : String(error)}`,
        'BusinessRulesDatabaseService.initializeDefaultRules',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Invalidate rules cache
   */
  private async invalidateRulesCache(clinicId?: string): Promise<void> {
    const cacheKeys = [`clinic_rules:${clinicId || 'global'}`, `clinic_rules:all`];

    for (const cacheKey of cacheKeys) {
      await this.cacheService.delete(cacheKey);
    }
  }
}
