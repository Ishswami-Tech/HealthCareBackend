import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { BusinessRulesDatabaseService } from './business-rules-database.service';
import type {
  BusinessRule,
  RuleEvaluationContext,
  RuleEvaluationResult,
} from '@core/types/appointment.types';
import type { RuleAction, RuleCondition } from '@core/types/common.types';

@Injectable()
export class BusinessRulesEngine {
  private readonly logger = new Logger(BusinessRulesEngine.name);
  private rulesCache = new Map<string, BusinessRule[]>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly rulesDatabase: BusinessRulesDatabaseService
  ) {}

  async evaluateRules(context: RuleEvaluationContext): Promise<RuleEvaluationResult> {
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
          if (Array.isArray(rule.actions) && rule.actions.length > 0) {
            // Convert RuleAction[] to Record<string, unknown>[] for result.actions
            const actionsArray = rule.actions as readonly RuleAction[];
            const mappedActions: Array<{
              type: string;
              message: string;
              severity: string;
              parameters?: unknown;
            }> = actionsArray.map((action: RuleAction) => ({
              type: action.type,
              message: action.message,
              severity: action.severity,
              ...(action.parameters && { parameters: action.parameters }),
            }));
            result.actions.push(...mappedActions);
          }
        } else {
          result.passed = false;
          result.violations.push(rule.description || rule.name);
        }
      }

      return result;
    } catch (_error) {
      this.logger.error('Error evaluating business rules:', _error);
      return {
        passed: false,
        appliedRules: [],
        violations: ['Business rules evaluation failed'],
        actions: [],
      };
    }
  }

  private async loadRules(context: RuleEvaluationContext): Promise<BusinessRule[]> {
    try {
      // Load rules from database
      const rules = await this.rulesDatabase.getClinicRules(
        (context.clinic as Record<string, unknown>)?.['id'] as string
      );

      // Convert to BusinessRule format
      return rules.map(rule => ({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        isActive: rule.isActive,
        category: rule.category || 'custom',
        version: rule.version || '1.0.0',
        tags: rule.tags || [],
        conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
        actions: Array.isArray(rule.actions) ? rule.actions : [],
        ...(rule.clinicId && { clinicId: rule.clinicId }),
        createdAt: rule.createdAt || new Date(),
        updatedAt: rule.updatedAt || new Date(),
      }));
    } catch (_error) {
      this.logger.error('Failed to load business rules from database', {
        clinicId: (context.clinic as Record<string, unknown>)?.['id'] as string,
        _error: _error instanceof Error ? _error.message : String(_error),
      });

      // Fallback to default rules
      return [
        {
          id: 'default-1',
          name: 'appointment-date-range',
          // description: 'Appointment must be within 3 days from today',
          description: 'Testing mode: appointment date range restriction disabled',
          priority: 0,
          isActive: true,
          category: 'appointment_creation',
          version: '1.0.0',
          tags: [],
          conditions: [
            {
              type: 'custom',
              field: 'date_range_check',
              value: true,
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            {
              type: 'block',
              // message: 'Appointments can only be booked up to 3 days in advance',
              message: 'Testing mode: appointment date range restriction disabled',
              severity: 'high',
            },
          ] as readonly import('@core/types').RuleAction[],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'default-2',
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
              value: true,
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            {
              type: 'notify',
              message: 'Appointment time validation required',
              severity: 'medium',
            },
          ] as readonly import('@core/types').RuleAction[],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'default-3',
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
              value: true,
              operator: 'AND',
            },
          ] as readonly import('@core/types').RuleCondition[],
          actions: [
            {
              type: 'block',
              message: 'Double booking detected',
              severity: 'high',
            },
          ] as readonly import('@core/types').RuleAction[],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    }
  }

  private async evaluateRule(rule: BusinessRule, context: RuleEvaluationContext): Promise<boolean> {
    try {
      if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
        return true; // No conditions means rule passes
      }

      // Check first condition for time validation
      const firstConditionRaw: unknown = rule.conditions[0];
      // Type guard to safely check if firstConditionRaw is a RuleCondition
      const isRuleCondition = (obj: unknown): obj is RuleCondition =>
        obj !== null &&
        typeof obj === 'object' &&
        'field' in obj &&
        'value' in obj &&
        typeof (obj as { field: unknown }).field === 'string';
      const firstCondition: RuleCondition | undefined = isRuleCondition(firstConditionRaw)
        ? firstConditionRaw
        : undefined;
      if (firstCondition && firstCondition.field === 'date_range_check') {
        // Date range check: appointment must be within 3 days from today (Commented for testing)
        // const appointmentDataRaw = context.appointment;
        // const appointmentData =
        //   appointmentDataRaw && typeof appointmentDataRaw === 'object'
        //     ? (appointmentDataRaw as Record<string, unknown>)
        //     : {};
        // const dateInput = (appointmentData['date'] || appointmentData['appointmentDate']) as
        //   | string
        //   | undefined;
        //
        // if (!dateInput) return false;
        //
        // const appointmentDate = new Date(dateInput);
        //
        // // Get today in IST timezone
        // const today = new Date();
        // const istOffset = 5.5 * 60 * 60 * 1000; // UTC + 5:30 hours
        // const todayIST = new Date(today.getTime() + istOffset);
        //
        // // Calculate max date (3 days from today in IST)
        // const maxDateIST = new Date(todayIST);
        // maxDateIST.setDate(todayIST.getDate() + 3);
        //
        // // Normalize to start of day for comparison
        // const appointmentDay = new Date(appointmentDate);
        // appointmentDay.setHours(0, 0, 0, 0);
        // const todayDay = new Date(todayIST);
        // todayDay.setHours(0, 0, 0, 0);
        // const maxDay = new Date(maxDateIST);
        // maxDay.setHours(0, 0, 0, 0);
        //
        // // Check if appointment is within valid range
        // return appointmentDay >= todayDay && appointmentDay <= maxDay;

        // Testing mode: bypass the default booking date-range restriction.
        return true;
      }

      if (firstCondition && firstCondition.field === 'time_validation') {
        // Extract working hours from condition value or context
        const conditionValueRaw: unknown = firstCondition.value;
        const conditionValue =
          conditionValueRaw && typeof conditionValueRaw === 'object'
            ? (conditionValueRaw as Record<string, unknown>)
            : undefined;
        const workingHours = conditionValue || {};
        const bufferMinutes =
          conditionValue && 'bufferMinutes' in conditionValue
            ? (conditionValue['bufferMinutes'] as number | undefined)
            : undefined;
        const appointmentData = (context.appointment as Record<string, unknown>) || {};
        const dateInput = (appointmentData['date'] || appointmentData['appointmentDate']) as string;
        const appointmentTime = new Date(dateInput);

        // Convert to IST to accurately extract hours/minutes regardless of server timezone
        const istOffset = 5.5 * 60 * 60 * 1000; // UTC + 5:30 hours
        const istTime = new Date(appointmentTime.getTime() + istOffset);

        const hour = istTime.getUTCHours();
        const minute = istTime.getUTCMinutes();
        const appointmentMinutes = hour * 60 + minute;

        const startMinutes = this.timeToMinutes(
          (workingHours['start'] as string | undefined) || '09:00'
        );
        const endMinutes = this.timeToMinutes(
          (workingHours['end'] as string | undefined) || '17:00'
        );
        const buffer = (bufferMinutes as number) || 0;

        return (
          appointmentMinutes >= startMinutes + buffer && appointmentMinutes <= endMinutes - buffer
        );
      }

      // Conflict check rule
      if (firstCondition && firstCondition.field === 'conflict_check') {
        const appointmentDataRaw = context.appointment;
        const appointmentData =
          appointmentDataRaw && typeof appointmentDataRaw === 'object'
            ? (appointmentDataRaw as Record<string, unknown>)
            : {};
        const doctorId = appointmentData['doctorId'] as string | undefined;
        let date = appointmentData['date'] as string | undefined;
        let time = appointmentData['time'] as string | undefined;

        // Fallback to appointmentDate if date/time are missing
        if ((!date || !time) && appointmentData['appointmentDate']) {
          const appointmentDateTime = new Date(appointmentData['appointmentDate'] as string);
          // Simple IST extraction (UTC + 5:30)
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istDate = new Date(appointmentDateTime.getTime() + istOffset);
          const isoString = istDate.toISOString();
          const parts = isoString.split('T');
          date = parts[0];
          const timePart = parts[1];
          time = timePart && timePart.length >= 5 ? timePart.substring(0, 5) : '00:00';
        }

        if (!doctorId || !date || !time) return false;

        // Check for existing appointments using executeHealthcareRead with client parameter
        const existingAppointments = await this.databaseService.executeHealthcareRead(
          async _client => {
            const prismaClient = _client as unknown as {
              appointment: {
                findMany: (args: {
                  where: {
                    doctorId: string;
                    date: Date;
                    status: { in: readonly string[] };
                  };
                }) => Promise<unknown[]>;
              };
            };
            return await prismaClient.appointment.findMany({
              where: {
                doctorId: doctorId,
                date: new Date(date),
                status: {
                  in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] as readonly string[],
                },
              },
            });
          }
        );

        return Array.isArray(existingAppointments) && existingAppointments.length === 0;
      }

      // Capacity check rule
      if (firstCondition && firstCondition.field === 'capacity_check') {
        const appointmentDataRaw = context.appointment;
        const appointmentData =
          appointmentDataRaw && typeof appointmentDataRaw === 'object'
            ? (appointmentDataRaw as Record<string, unknown>)
            : {};
        const locationId = appointmentData['locationId'] as string | undefined;
        let date = appointmentData['date'] as string | undefined;
        let time = appointmentData['time'] as string | undefined;

        // Fallback to appointmentDate if date/time are missing
        if ((!date || !time) && appointmentData['appointmentDate']) {
          const appointmentDateTime = new Date(appointmentData['appointmentDate'] as string);
          // Simple IST extraction (UTC + 5:30)
          const istOffset = 5.5 * 60 * 60 * 1000;
          const istDate = new Date(appointmentDateTime.getTime() + istOffset);
          const isoString = istDate.toISOString();
          const parts = isoString.split('T');
          date = parts[0];
          const timePart = parts[1];
          time = timePart && timePart.length >= 5 ? timePart.substring(0, 5) : '00:00';
        }

        if (!locationId || !date || !time) return false;

        // Get location using executeHealthcareRead with client parameter
        const location = await this.databaseService.executeHealthcareRead(async _client => {
          const prismaClient = _client as unknown as {
            clinicLocation: {
              findUnique: (args: {
                where: { id: string };
              }) => Promise<{ id: string; capacity?: number | null } | null>;
            };
          };
          return await prismaClient.clinicLocation.findUnique({
            where: { id: locationId },
          });
        });

        if (!location) return false;

        // Count appointments using DatabaseService safe method
        const currentBookings = await this.databaseService.countAppointmentsSafe({
          locationId: locationId,
          date: new Date(date),
          status: {
            in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] as readonly string[],
          },
        } as never);

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
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  }

  async addRule(rule: Omit<BusinessRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<BusinessRule> {
    try {
      const newRule = await this.rulesDatabase.createRule({
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        isActive: rule.isActive,
        category: rule.category,
        version: rule.version,
        tags: rule.tags,
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
        category: newRule.category,
        version: newRule.version,
        tags: newRule.tags,
        conditions: newRule.conditions,
        actions: newRule.actions,
        ...(newRule.clinicId && { clinicId: newRule.clinicId }),
        createdAt: newRule.createdAt,
        updatedAt: newRule.updatedAt,
      };
    } catch (_error) {
      this.logger.error(`Failed to add business rule`, {
        ruleName: rule.name,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  async updateRule(id: string, updates: Partial<BusinessRule>): Promise<BusinessRule | null> {
    try {
      const updatedRule = await this.rulesDatabase.updateRule(id, {
        ...(updates.name && { name: updates.name }),
        ...(updates.description && { description: updates.description }),
        ...(updates.priority !== undefined && { priority: updates.priority }),
        ...(updates.isActive !== undefined && { isActive: updates.isActive }),
        ...(updates.category && { category: updates.category }),
        ...(updates.version && { version: updates.version }),
        ...(updates.tags && { tags: updates.tags }),
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
        category: updatedRule.category,
        version: updatedRule.version,
        tags: updatedRule.tags,
        conditions: updatedRule.conditions,
        actions: updatedRule.actions,
        ...(updatedRule.clinicId && { clinicId: updatedRule.clinicId }),
        createdAt: updatedRule.createdAt,
        updatedAt: updatedRule.updatedAt,
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
    context: unknown
  ): Promise<RuleEvaluationResult> {
    try {
      const ruleContext: RuleEvaluationContext = {
        appointment: createDto,
        patient: (context as Record<string, unknown>)['patient'] as Record<string, unknown>,
        doctor: (context as Record<string, unknown>)['doctor'] as Record<string, unknown>,
        clinic: (context as Record<string, unknown>)['clinic'] as Record<string, unknown>,
        location: (context as Record<string, unknown>)['location'] as Record<string, unknown>,
        timeSlot: (context as Record<string, unknown>)['timeSlot'] as Record<string, unknown>,
      };

      return this.evaluateRules(ruleContext);
    } catch (_error) {
      this.logger.error('Error validating appointment creation:', _error);
      return {
        passed: false,
        appliedRules: [],
        violations: ['Appointment creation validation failed'],
        actions: [],
      };
    }
  }
}
