import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@database/prisma/prisma.service";
import { CacheService } from "@infrastructure/cache";

export interface BusinessRuleEntity {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  clinicId?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BusinessRulesDatabaseService {
  private readonly logger = new Logger(BusinessRulesDatabaseService.name);
  private readonly RULES_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Create business rule
   */
  async createRule(
    ruleData: Omit<BusinessRuleEntity, "id" | "createdAt" | "updatedAt">,
  ): Promise<BusinessRuleEntity> {
    try {
      const rule = await this.prisma.businessRule.create({
        data: {
          name: ruleData.name,
          description: ruleData.description,
          priority: ruleData.priority,
          isActive: ruleData.isActive,
          conditions: ruleData.conditions,
          actions: ruleData.actions,
          clinicId: ruleData.clinicId,
        },
      });

      // Cache the rule
      const cacheKey = `business_rule:${rule.id}`;
      await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);

      // Invalidate rules cache
      await this.invalidateRulesCache(ruleData.clinicId);

      this.logger.log(`Created business rule ${rule.id}`, {
        name: ruleData.name,
        clinicId: ruleData.clinicId,
        priority: ruleData.priority,
      });

      return rule as BusinessRuleEntity;
    } catch (error) {
      this.logger.error(`Failed to create business rule`, {
        ruleName: ruleData.name,
        clinicId: ruleData.clinicId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get rules for clinic
   */
  async getClinicRules(clinicId?: string): Promise<BusinessRuleEntity[]> {
    const cacheKey = `clinic_rules:${clinicId || "global"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as BusinessRuleEntity[];
      }

      const rules = await this.prisma.businessRule.findMany({
        where: {
          isActive: true,
          OR: [
            { clinicId: clinicId },
            { clinicId: null }, // Global rules
          ],
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });

      await this.cacheService.set(cacheKey, rules, this.RULES_CACHE_TTL);
      return rules as BusinessRuleEntity[];
    } catch (error) {
      this.logger.error(`Failed to get clinic rules`, {
        clinicId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update business rule
   */
  async updateRule(
    ruleId: string,
    updateData: Partial<BusinessRuleEntity>,
  ): Promise<BusinessRuleEntity> {
    try {
      const rule = await this.prisma.businessRule.update({
        where: { id: ruleId },
        data: {
          name: updateData.name,
          description: updateData.description,
          priority: updateData.priority,
          isActive: updateData.isActive,
          conditions: updateData.conditions,
          actions: updateData.actions,
        },
      });

      // Update cache
      const cacheKey = `business_rule:${ruleId}`;
      await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);

      // Invalidate rules cache
      await this.invalidateRulesCache(rule.clinicId);

      this.logger.log(`Updated business rule ${ruleId}`, {
        updates: Object.keys(updateData),
      });

      return rule as BusinessRuleEntity;
    } catch (error) {
      this.logger.error(`Failed to update business rule`, {
        ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete business rule
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    try {
      await this.prisma.businessRule.delete({
        where: { id: ruleId },
      });

      // Remove from cache
      const cacheKey = `business_rule:${ruleId}`;
      await this.cacheService.delete(cacheKey);

      // Invalidate rules cache
      await this.invalidateRulesCache();

      this.logger.log(`Deleted business rule ${ruleId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete business rule`, {
        ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
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

      const rule = await this.prisma.businessRule.findUnique({
        where: { id: ruleId },
      });

      if (rule) {
        await this.cacheService.set(cacheKey, rule, this.RULES_CACHE_TTL);
      }

      return rule as BusinessRuleEntity | null;
    } catch (error) {
      this.logger.error(`Failed to get business rule`, {
        ruleId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Initialize default business rules
   */
  async initializeDefaultRules(): Promise<void> {
    try {
      const defaultRules = [
        {
          name: "appointment-time-validation",
          description: "Appointment must be during working hours",
          priority: 1,
          isActive: true,
          conditions: {
            type: "time_validation",
            workingHours: { start: "09:00", end: "18:00" },
          },
          actions: { notify: true, block: false },
          clinicId: undefined, // Global rule
        },
        {
          name: "double-booking-prevention",
          description: "Doctor cannot have overlapping appointments",
          priority: 2,
          isActive: true,
          conditions: {
            type: "conflict_check",
            bufferMinutes: 15,
          },
          actions: { block: true, suggestAlternatives: true },
          clinicId: undefined, // Global rule
        },
        {
          name: "emergency-override",
          description: "Emergency appointments can override conflicts",
          priority: 0,
          isActive: true,
          conditions: {
            type: "priority_check",
            priority: "emergency",
          },
          actions: { override: true, notify: true },
          clinicId: undefined, // Global rule
        },
      ];

      for (const ruleData of defaultRules) {
        const existing = await this.prisma.businessRule.findFirst({
          where: { name: ruleData.name },
        });

        if (!existing) {
          await this.createRule(ruleData);
        }
      }

      this.logger.log("Initialized default business rules");
    } catch (error) {
      this.logger.error("Failed to initialize default business rules", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Invalidate rules cache
   */
  private async invalidateRulesCache(clinicId?: string): Promise<void> {
    const cacheKeys = [
      `clinic_rules:${clinicId || "global"}`,
      `clinic_rules:all`,
    ];

    for (const cacheKey of cacheKeys) {
      await this.cacheService.delete(cacheKey);
    }
  }
}
