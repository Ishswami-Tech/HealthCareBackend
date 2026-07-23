import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { QueueService, JobPriority, HEALTHCARE_QUEUE } from '@infrastructure/queue';
import { DatabaseService } from '@infrastructure/database';
import { JobType } from '@core/types/queue.types';
import type { ReminderSchedule, ReminderRule, ReminderResult } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { ReminderSchedule, ReminderRule, ReminderResult };

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);
  private readonly RULE_CACHE_TTL = 7200; // 2 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly queueService: QueueService,
    private readonly databaseService: DatabaseService
  ) {}

  buildReminderJobId(appointmentId: string, reminderType: string): string {
    return `reminder:${reminderType}:${appointmentId}`;
  }

  /**
   * Schedule a reminder for an appointment
   */
  async scheduleReminder(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    reminderType: string,
    hoursBefore: number,
    channels: string[],
    templateData: unknown,
    scheduledFor?: Date
  ): Promise<ReminderResult> {
    const jobId = this.buildReminderJobId(appointmentId, reminderType);
    const resolvedScheduledFor =
      scheduledFor instanceof Date && !Number.isNaN(scheduledFor.getTime())
        ? scheduledFor
        : new Date(Date.now() + hoursBefore * 60 * 60 * 1000);
    const delayMs = Math.max(0, resolvedScheduledFor.getTime() - Date.now());

    this.logger.log(`Scheduling reminder ${jobId}`, {
      appointmentId,
      reminderType,
      hoursBefore,
      scheduledFor: resolvedScheduledFor,
    });

    try {
      const reminderData: ReminderSchedule = {
        id: jobId,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        reminderType: reminderType as
          | 'appointment_reminder'
          | 'follow_up'
          | 'prescription'
          | 'payment',
        scheduledFor: resolvedScheduledFor,
        status: 'scheduled',
        channels: channels as ('push' | 'email' | 'socket' | 'sms' | 'whatsapp')[],
        priority: 'normal',
        templateData: templateData as {
          patientName: string;
          doctorName: string;
          appointmentDate: string;
          appointmentTime: string;
          location: string;
          clinicName: string;
          appointmentType?: string;
          notes?: string;
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.queueService.addJob(
        JobType.REMINDER,
        reminderData.reminderType,
        {
          reminderId: jobId,
          appointmentId,
          patientId,
          doctorId,
          clinicId,
          reminderType: reminderData.reminderType,
          scheduledFor: resolvedScheduledFor,
          channels: reminderData.channels,
          priority: reminderData.priority,
          templateData: reminderData.templateData,
        },
        {
          correlationId: jobId,
          delay: delayMs,
          priority: JobPriority.NORMAL as unknown as number,
          attempts: 3,
          removeOnComplete: 100,
          removeOnFail: 50,
        }
      );

      return {
        success: true,
        reminderId: jobId,
        scheduledFor: resolvedScheduledFor,
        channels,
        message: `Reminder queued for ${resolvedScheduledFor.toISOString()}`,
      };
    } catch (_error) {
      this.logger.error(`Failed to schedule reminder ${jobId}`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
        appointmentId,
        stack: _error instanceof Error ? _error.stack : undefined,
      });

      return {
        success: false,
        reminderId: jobId,
        scheduledFor: resolvedScheduledFor,
        channels,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      };
    }
  }

  async rescheduleReminder(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    reminderType: string,
    hoursBefore: number,
    channels: string[],
    templateData: unknown,
    scheduledFor?: Date
  ): Promise<ReminderResult> {
    await this.cancelAppointmentReminder(appointmentId, reminderType);
    return await this.scheduleReminder(
      appointmentId,
      patientId,
      doctorId,
      clinicId,
      reminderType,
      hoursBefore,
      channels,
      templateData,
      scheduledFor
    );
  }

  /**
   * Process scheduled reminders
   */
  async processScheduledReminders(): Promise<{
    processed: number;
    sent: number;
    failed: number;
  }> {
    this.logger.log('Inspecting queued reminders');

    try {
      const jobs = await this.queueService.getJobs(HEALTHCARE_QUEUE, {
        status: ['waiting', 'active', 'delayed'],
      });
      const reminderJobs = jobs.filter(job => {
        const jobData = job.data as Record<string, unknown>;
        const nestedData =
          typeof jobData['data'] === 'object' && jobData['data'] !== null
            ? (jobData['data'] as Record<string, unknown>)
            : undefined;
        return (
          String(jobData['jobType']) === 'reminder' ||
          String(job.name) === 'reminder' ||
          nestedData?.['reminderType'] !== undefined
        );
      });

      this.logger.log(`Found ${reminderJobs.length} queued reminder jobs`);
      return { processed: reminderJobs.length, sent: 0, failed: 0 };
    } catch (_error) {
      this.logger.error('Failed to process scheduled reminders', {
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });
    }

    return { processed: 0, sent: 0, failed: 0 };
  }

  /**
   * Cancel a scheduled reminder
   */
  async cancelReminder(reminderId: string): Promise<boolean> {
    try {
      const removed = await this.queueService.removeJob(HEALTHCARE_QUEUE, reminderId);
      if (!removed) {
        this.logger.warn(`Reminder job ${reminderId} not found`);
        return false;
      }

      this.logger.log(`Reminder ${reminderId} cancelled`);
      return true;
    } catch (_error) {
      this.logger.error(`Failed to cancel reminder ${reminderId}`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });
      return false;
    }
  }

  async cancelAppointmentReminder(
    appointmentId: string,
    reminderType: string = 'appointment_reminder'
  ): Promise<boolean> {
    const jobId = this.buildReminderJobId(appointmentId, reminderType);
    return await this.cancelReminder(jobId);
  }

  /**
   * Get reminder rules for a clinic
   */
  async getReminderRules(clinicId: string): Promise<ReminderRule[]> {
    const cacheKey = `reminder_rules:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as ReminderRule[];
      }

      // Get reminder rules from database using executeHealthcareRead
      const rules = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            reminderRule: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).reminderRule.findMany({
          where: {
            clinicId,
            isActive: true,
          },
          orderBy: {
            hoursBefore: 'asc',
          },
        } as never);
      });

      interface ReminderRuleRow {
        id: string;
        clinicId: string;
        reminderType: string;
        hoursBefore: number;
        isActive: boolean;
        channels: string[];
        template: string;
        conditions: unknown;
      }

      type ReminderConditions = {
        appointmentType?: string[];
        priority?: string[];
        patientAge?: { min: number; max: number };
      };

      const ruleList: ReminderRule[] = (rules as ReminderRuleRow[]).map((rule: ReminderRuleRow) => {
        let conditions: ReminderConditions | undefined;
        if (rule.conditions && typeof rule.conditions === 'object' && rule.conditions !== null) {
          const cond = rule.conditions as Record<string, unknown>;
          conditions = {};
          if (Array.isArray(cond['appointmentType'])) {
            conditions.appointmentType = cond['appointmentType'] as string[];
          }
          if (Array.isArray(cond['priority'])) {
            conditions.priority = cond['priority'] as string[];
          }
          if (
            cond['patientAge'] &&
            typeof cond['patientAge'] === 'object' &&
            cond['patientAge'] !== null
          ) {
            const age = cond['patientAge'] as Record<string, unknown>;
            if (typeof age['min'] === 'number' && typeof age['max'] === 'number') {
              conditions.patientAge = {
                min: age['min'],
                max: age['max'],
              };
            }
          }
        }

        return {
          id: rule.id,
          clinicId: rule.clinicId,
          reminderType: rule.reminderType,
          hoursBefore: rule.hoursBefore,
          isActive: rule.isActive,
          channels: rule.channels,
          template: rule.template,
          ...(conditions && { conditions }),
        };
      });

      await this.cacheService.set(cacheKey, ruleList, this.RULE_CACHE_TTL);
      return ruleList;
    } catch (_error) {
      this.logger.error('Failed to get reminder rules', {
        error: _error instanceof Error ? _error.message : 'Unknown error',
        clinicId,
      });
      return [];
    }
  }

  /**
   * Create or update reminder rule
   */
  async createReminderRule(rule: Omit<ReminderRule, 'id'>): Promise<ReminderRule> {
    const ruleId = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRule: ReminderRule = {
      id: ruleId,
      ...rule,
    };

    try {
      // Store in cache
      const cacheKey = `reminder_rules:${rule.clinicId}`;
      const existingRules = await this.getReminderRules(rule.clinicId);
      const updatedRules = [...existingRules, newRule];

      await this.cacheService.set(cacheKey, updatedRules, this.RULE_CACHE_TTL);

      this.logger.log(`Created reminder rule ${ruleId}`, {
        clinicId: rule.clinicId,
      });
      return newRule;
    } catch (_error) {
      this.logger.error(`Failed to create reminder rule`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
        clinicId: rule.clinicId,
      });
      throw _error;
    }
  }

  /**
   * Get reminder statistics
   */
  getReminderStats(
    _clinicId: string,
    _dateRange: { from: Date; to: Date }
  ): Promise<{
    totalScheduled: number;
    totalSent: number;
    totalFailed: number;
    successRate: number;
    averageResponseTime: number;
  }> {
    // Calculate statistics from database
    // Note: reminderSchedule model doesn't exist in Prisma schema
    // Returning mock statistics until model is added
    const totalScheduled = 0;
    const totalSent = 0;
    const totalFailed = 0;
    interface SentReminder {
      scheduledFor: Date;
      sentAt: Date;
    }
    const sentReminders: SentReminder[] = [];

    const averageResponseTime =
      sentReminders.length > 0
        ? sentReminders.reduce((sum, reminder) => {
            if (reminder.scheduledFor && reminder.sentAt) {
              const responseTime =
                (new Date(reminder.sentAt).getTime() - new Date(reminder.scheduledFor).getTime()) /
                (1000 * 60); // in minutes
              return sum + responseTime;
            }
            return sum;
          }, 0) / sentReminders.length
        : 0;

    const successRate = totalScheduled > 0 ? (totalSent / totalScheduled) * 100 : 0;

    return Promise.resolve({
      totalScheduled,
      totalSent,
      totalFailed,
      successRate: Math.round(successRate * 10) / 10,
      averageResponseTime: Math.round(averageResponseTime * 10) / 10,
    });
  }
}
