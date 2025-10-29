import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@database/prisma/prisma.service";
import { LoggingService } from "@infrastructure/logging";
import { BusinessRulesDatabaseService } from "./business-rules-database.service";

export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: Record<string, unknown>;
  actions: Record<string, unknown>;
  clinicId?: string;
}

export interface RuleEvaluationContext {
  appointment: unknown;
  patient: unknown;
  doctor: unknown;
  clinic: unknown;
  location?: unknown;
  timeSlot?: unknown;
}

export interface RuleEvaluationResult {
  passed: boolean;
  appliedRules: string[];
  violations: string[];
  actions: Record<string, unknown>[];
}

@Injectable()
export class BusinessRulesEngine {
  private readonly logger = new Logger(BusinessRulesEngine.name);
  private rulesCache = new Map<string, BusinessRule[]>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly rulesDatabase: BusinessRulesDatabaseService,
  ) {}

  async evaluateRules(
    context: RuleEvaluationContext,
  ): Promise<RuleEvaluationResult> {
    try {
      const rules = await this.loadRules(context);
      const result: RuleEvaluationResult = {
        passed: true,
        appliedRules: [],
        violations: [],
        actions: [],
      };

      for (const rule of rules) {
        if (await this.evaluateRule(rule, context)) {
          result.appliedRules.push(rule.name);
          if (rule.actions) {
            result.actions.push(rule.actions);
          }
        } else {
          result.passed = false;
          result.violations.push(rule.description || rule.name);
        }
      }

      return result;
    } catch (_error) {
      this.logger.error("Error evaluating business rules:", _error);
      return {
        passed: false,
        appliedRules: [],
        violations: ["Business rules evaluation failed"],
        actions: [],
      };
    }
  }

  private async loadRules(
    context: RuleEvaluationContext,
  ): Promise<BusinessRule[]> {
    try {
      // Load rules from database
      const rules = await this.rulesDatabase.getClinicRules(
        (context.clinic as Record<string, unknown>)?.["id"] as string,
      );

      // Convert to BusinessRule format
      return rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        isActive: rule.isActive,
        conditions: rule.conditions,
        actions: rule.actions,
      }));
    } catch (_error) {
      this.logger.error("Failed to load business rules from database", {
        clinicId: (context.clinic as Record<string, unknown>)?.["id"] as string,
        _error: _error instanceof Error ? _error.message : String(_error),
      });

      // Fallback to default rules
      return [
        {
          id: "default-1",
          name: "appointment-time-validation",
          description: "Appointment must be during working hours",
          priority: 1,
          isActive: true,
          conditions: { type: "time_validation" },
          actions: { notify: true },
        },
        {
          id: "default-2",
          name: "double-booking-prevention",
          description: "Doctor cannot have overlapping appointments",
          priority: 2,
          isActive: true,
          conditions: { type: "conflict_check" },
          actions: { block: true },
        },
      ];
    }
  }

  private async evaluateRule(
    rule: BusinessRule,
    context: RuleEvaluationContext,
  ): Promise<boolean> {
    try {
      // Time validation rule
      if (rule.conditions?.["type"] === "time_validation") {
        const { workingHours, bufferMinutes } = rule.conditions;
        const appointmentTime = new Date(
          (context.appointment as Record<string, unknown>)?.["date"] as string,
        );
        const hour = appointmentTime.getHours();
        const minute = appointmentTime.getMinutes();
        const appointmentMinutes = hour * 60 + minute;

        const startMinutes = this.timeToMinutes(
          (workingHours as Record<string, unknown>)["start"] as string,
        );
        const endMinutes = this.timeToMinutes(
          (workingHours as Record<string, unknown>)["end"] as string,
        );
        const buffer = (bufferMinutes as number) || 0;

        return (
          appointmentMinutes >= startMinutes + buffer &&
          appointmentMinutes <= endMinutes - buffer
        );
      }

      // Conflict check rule
      if (rule.conditions?.["type"] === "conflict_check") {
        const { doctorId, date, time } = context.appointment as Record<
          string,
          unknown
        >;
        if (!doctorId || !date || !time) return false;

        // Check for existing appointments
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const existingAppointments =
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          await this.prismaService.appointment.findMany({
            where: {
              doctorId,
              date: new Date(date as string),
              status: {
                in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"],
              },
            },
          });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return existingAppointments.length === 0;
      }

      // Capacity check rule
      if (rule.conditions?.["type"] === "capacity_check") {
        const { locationId, date, time } = context.appointment as Record<
          string,
          unknown
        >;
        if (!locationId || !date || !time) return false;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const location = await this.prismaService["clinicLocation"].findUnique({
          where: { id: locationId },
        });

        if (!location) return false;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const currentBookings = await this.prismaService.appointment.count({
          where: {
            locationId,
            date: new Date(date as string),
            status: {
              in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"],
            },
          },
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        return currentBookings < (location.capacity || 1);
      }

      return true;
    } catch (_error) {
      this.logger.error(`Failed to evaluate rule ${rule.id}`, {
        ruleName: rule.name,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return false;
    }
  }

  private timeToMinutes(timeString: string): number {
    const [hours, minutes] = timeString.split(":").map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  }

  async addRule(rule: Omit<BusinessRule, "id">): Promise<BusinessRule> {
    try {
      const newRule = await this.rulesDatabase.createRule({
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        isActive: rule.isActive,
        conditions: rule.conditions,
        actions: rule.actions,
        ...(rule.clinicId && { clinicId: rule.clinicId }),
      });

      this.logger.log(`Business rule added: ${newRule.name}`);
      return {
        id: newRule.id,
        name: newRule.name,
        description: newRule.description,
        priority: newRule.priority,
        isActive: newRule.isActive,
        conditions: newRule.conditions,
        actions: newRule.actions,
        ...(newRule.clinicId && { clinicId: newRule.clinicId }),
      };
    } catch (_error) {
      this.logger.error(`Failed to add business rule`, {
        ruleName: rule.name,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  async updateRule(
    id: string,
    updates: Partial<BusinessRule>,
  ): Promise<BusinessRule | null> {
    try {
      const updatedRule = await this.rulesDatabase.updateRule(id, {
        ...(updates.name && { name: updates.name }),
        ...(updates.description && { description: updates.description }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.conditions && { conditions: updates.conditions }),
        ...(updates.actions && { actions: updates.actions }),
        ...(updates.clinicId && { clinicId: updates.clinicId }),
      });

      if (!updatedRule) {
        return null;
      }

      this.logger.log(`Business rule updated: ${id}`);
      return {
        id: updatedRule.id,
        name: updatedRule.name,
        description: updatedRule.description,
        priority: updatedRule.priority,
        isActive: updatedRule.isActive,
        conditions: updatedRule.conditions,
        actions: updatedRule.actions,
        ...(updatedRule.clinicId && { clinicId: updatedRule.clinicId }),
      };
    } catch (_error) {
      this.logger.error(`Failed to update business rule`, {
        ruleId: id,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return null;
    }
  }

  async deleteRule(id: string): Promise<boolean> {
    try {
      const deleted = await this.rulesDatabase.deleteRule(id);
      this.logger.log(`Business rule deleted: ${id}`);
      return deleted;
    } catch (_error) {
      this.logger.error(`Failed to delete business rule`, {
        ruleId: id,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return false;
    }
  }

  async getRulesByClinic(_clinicId: string): Promise<BusinessRule[]> {
    return this.loadRules({} as RuleEvaluationContext);
  }

  async validateAppointmentCreation(
    createDto: unknown,
    context: unknown,
  ): Promise<RuleEvaluationResult> {
    try {
      const ruleContext: RuleEvaluationContext = {
        appointment: createDto,
        patient: (context as Record<string, unknown>)["patient"] as Record<
          string,
          unknown
        >,
        doctor: (context as Record<string, unknown>)["doctor"] as Record<
          string,
          unknown
        >,
        clinic: (context as Record<string, unknown>)["clinic"] as Record<
          string,
          unknown
        >,
        location: (context as Record<string, unknown>)["location"] as Record<
          string,
          unknown
        >,
        timeSlot: (context as Record<string, unknown>)["timeSlot"] as Record<
          string,
          unknown
        >,
      };

      return this.evaluateRules(ruleContext);
    } catch (_error) {
      this.logger.error("Error validating appointment creation:", _error);
      return {
        passed: false,
        appliedRules: [],
        violations: ["Appointment creation validation failed"],
        actions: [],
      };
    }
  }
}
