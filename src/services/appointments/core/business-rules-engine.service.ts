import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../libs/infrastructure/database";
import { LoggingService } from "../../../libs/infrastructure/logging";

export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  conditions: Record<string, any>;
  actions: Record<string, any>;
}

export interface RuleEvaluationContext {
  appointment: any;
  patient: any;
  doctor: any;
  clinic: any;
  location?: any;
  timeSlot?: any;
}

export interface RuleEvaluationResult {
  passed: boolean;
  appliedRules: string[];
  violations: string[];
  actions: Record<string, any>[];
}

@Injectable()
export class BusinessRulesEngine {
  private readonly logger = new Logger(BusinessRulesEngine.name);
  private rulesCache = new Map<string, BusinessRule[]>();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly loggingService: LoggingService,
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
    } catch (error) {
      this.logger.error("Error evaluating business rules:", error);
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
    // Mock implementation - in production, load from database
    return [
      {
        id: "1",
        name: "appointment-time-validation",
        description: "Appointment must be during working hours",
        priority: 1,
        isActive: true,
        conditions: { type: "time_validation" },
        actions: { notify: true },
      },
      {
        id: "2",
        name: "double-booking-prevention",
        description: "Doctor cannot have overlapping appointments",
        priority: 2,
        isActive: true,
        conditions: { type: "conflict_check" },
        actions: { block: true },
      },
    ];
  }

  private async evaluateRule(
    rule: BusinessRule,
    context: RuleEvaluationContext,
  ): Promise<boolean> {
    // Mock implementation - in production, implement proper rule evaluation logic
    if (rule.conditions?.type === "time_validation") {
      return true; // Mock: assume time is valid
    }

    if (rule.conditions?.type === "conflict_check") {
      return true; // Mock: assume no conflicts
    }

    return true;
  }

  async addRule(rule: Omit<BusinessRule, "id">): Promise<BusinessRule> {
    // Mock implementation - in production, save to database
    const newRule: BusinessRule = {
      ...rule,
      id: Math.random().toString(36).substr(2, 9),
    };

    this.logger.log(`Business rule added: ${newRule.name}`);
    return newRule;
  }

  async updateRule(
    id: string,
    updates: Partial<BusinessRule>,
  ): Promise<BusinessRule | null> {
    // Mock implementation - in production, update in database
    this.logger.log(`Business rule updated: ${id}`);
    return null;
  }

  async deleteRule(id: string): Promise<boolean> {
    // Mock implementation - in production, delete from database
    this.logger.log(`Business rule deleted: ${id}`);
    return true;
  }

  async getRulesByClinic(clinicId: string): Promise<BusinessRule[]> {
    return this.loadRules({} as RuleEvaluationContext);
  }

  async validateAppointmentCreation(
    createDto: any,
    context: any,
  ): Promise<RuleEvaluationResult> {
    try {
      const ruleContext: RuleEvaluationContext = {
        appointment: createDto,
        patient: context.patient,
        doctor: context.doctor,
        clinic: context.clinic,
        location: context.location,
        timeSlot: context.timeSlot,
      };

      return this.evaluateRules(ruleContext);
    } catch (error) {
      this.logger.error("Error validating appointment creation:", error);
      return {
        passed: false,
        appliedRules: [],
        violations: ["Appointment creation validation failed"],
        actions: [],
      };
    }
  }
}
