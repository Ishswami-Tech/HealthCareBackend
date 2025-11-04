import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { AppointmentNotificationService } from '../notifications/appointment-notification.service';
import { DatabaseService } from '@infrastructure/database';
import type { ReminderSchedule, ReminderRule, ReminderResult } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { ReminderSchedule, ReminderRule, ReminderResult };

@Injectable()
export class AppointmentReminderService {
  private readonly logger = new Logger(AppointmentReminderService.name);
  private readonly REMINDER_CACHE_TTL = 3600; // 1 hour
  private readonly RULE_CACHE_TTL = 7200; // 2 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly notificationService: AppointmentNotificationService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService
  ) {}

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
    templateData: unknown
  ): Promise<ReminderResult> {
    const reminderId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scheduledFor = new Date(Date.now() + hoursBefore * 60 * 60 * 1000);

    this.logger.log(`Scheduling reminder ${reminderId}`, {
      appointmentId,
      reminderType,
      hoursBefore,
      scheduledFor,
    });

    try {
      // Store reminder in cache
      const reminderData: ReminderSchedule = {
        id: reminderId,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        reminderType: reminderType as
          | 'appointment_reminder'
          | 'follow_up'
          | 'prescription'
          | 'payment',
        scheduledFor,
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

      const cacheKey = `reminder:${reminderId}`;
      await this.cacheService.set(
        cacheKey,
        reminderData,
        Math.floor((scheduledFor.getTime() - Date.now()) / 1000) + 3600 // 1 hour buffer
      );

      // Schedule the actual reminder execution
      await this.scheduleReminderExecution(reminderData);

      return {
        success: true,
        reminderId,
        scheduledFor,
        channels,
        message: `Reminder scheduled for ${scheduledFor.toISOString()}`,
      };
    } catch (_error) {
      this.logger.error(`Failed to schedule reminder ${reminderId}`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
        appointmentId,
      });

      return {
        success: false,
        reminderId,
        scheduledFor,
        channels,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process scheduled reminders
   */
  async processScheduledReminders(): Promise<{
    processed: number;
    sent: number;
    failed: number;
  }> {
    this.logger.log('Processing scheduled reminders');

    let processed = 0;
    let sent = 0;
    let failed = 0;

    try {
      // In a real implementation, this would query the database for due reminders
      // For now, we'll simulate processing
      const dueReminders = await this.getDueReminders();

      for (const reminder of dueReminders) {
        processed++;
        try {
          await this.executeReminder(reminder);
          sent++;
        } catch (_error) {
          failed++;
          this.logger.error(`Failed to execute reminder ${reminder.id}`, {
            error: _error instanceof Error ? _error.message : 'Unknown error',
          });
        }
      }

      this.logger.log(`Processed ${processed} reminders: ${sent} sent, ${failed} failed`);
    } catch (_error) {
      this.logger.error('Failed to process scheduled reminders', {
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });
    }

    return { processed, sent, failed };
  }

  /**
   * Cancel a scheduled reminder
   */
  async cancelReminder(reminderId: string): Promise<boolean> {
    try {
      const cacheKey = `reminder:${reminderId}`;
      const reminder = await this.cacheService.get(cacheKey);

      if (!reminder) {
        this.logger.warn(`Reminder ${reminderId} not found`);
        return false;
      }

      // Update status to cancelled
      const updatedReminder = {
        ...reminder,
        status: 'cancelled',
        updatedAt: new Date(),
      };

      await this.cacheService.set(cacheKey, updatedReminder, this.REMINDER_CACHE_TTL);

      this.logger.log(`Reminder ${reminderId} cancelled`);
      return true;
    } catch (_error) {
      this.logger.error(`Failed to cancel reminder ${reminderId}`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });
      return false;
    }
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

      const ruleList: ReminderRule[] = rules.map((rule: any) => ({
        id: rule.id,
        clinicId: rule.clinicId,
        reminderType: rule.reminderType,
        hoursBefore: rule.hoursBefore,
        isActive: rule.isActive,
        channels: rule.channels,
        template: rule.template,
        conditions: rule.conditions,
      }));

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
  async getReminderStats(
    clinicId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    dateRange: { from: Date; to: Date }
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
    const sentReminders: Array<{ scheduledFor: Date; sentAt: Date }> = [];

    const averageResponseTime =
      sentReminders.length > 0
        ? sentReminders.reduce((sum: any, reminder: any) => {
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

    return {
      totalScheduled,
      totalSent,
      totalFailed,
      successRate: Math.round(successRate * 10) / 10,
      averageResponseTime: Math.round(averageResponseTime * 10) / 10,
    };
  }

  /**
   * Schedule reminder execution
   */
  private async scheduleReminderExecution(reminder: ReminderSchedule): Promise<void> {
    // In a real implementation, this would use a job queue like BullMQ
    // For now, we'll just log the scheduling
    this.logger.log(`Scheduled reminder execution for ${reminder.scheduledFor.toISOString()}`, {
      reminderId: reminder.id,
      appointmentId: reminder.appointmentId,
    });
  }

  /**
   * Execute a reminder
   */
  private async executeReminder(reminder: ReminderSchedule): Promise<void> {
    this.logger.log(`Executing reminder ${reminder.id}`, {
      appointmentId: reminder.appointmentId,
      reminderType: reminder.reminderType,
    });

    try {
      // Send notification through the notification service
      const notificationData = {
        appointmentId: reminder.appointmentId,
        patientId: reminder.patientId,
        doctorId: reminder.doctorId,
        clinicId: reminder.clinicId,
        type: (reminder.reminderType === 'appointment_reminder' ? 'reminder' : 'follow_up') as
          | 'reminder'
          | 'confirmation'
          | 'cancellation'
          | 'reschedule'
          | 'follow_up',
        priority: reminder.priority,
        channels: reminder.channels,
        templateData: reminder.templateData,
      };

      const result = await this.notificationService.sendNotification(notificationData);

      // Update reminder status
      const updatedReminder = {
        ...reminder,
        status: result.success ? 'sent' : 'failed',
        updatedAt: new Date(),
      };

      const cacheKey = `reminder:${reminder.id}`;
      await this.cacheService.set(cacheKey, updatedReminder, this.REMINDER_CACHE_TTL);

      this.logger.log(`Reminder ${reminder.id} executed successfully`, {
        success: result.success,
        sentChannels: result.sentChannels,
      });
    } catch (_error) {
      this.logger.error(`Failed to execute reminder ${reminder.id}`, {
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });

      // Update reminder status to failed
      const failedReminder = {
        ...reminder,
        status: 'failed',
        updatedAt: new Date(),
      };

      const cacheKey = `reminder:${reminder.id}`;
      await this.cacheService.set(cacheKey, failedReminder, this.REMINDER_CACHE_TTL);

      throw _error;
    }
  }

  /**
   * Get due reminders
   */
  private async getDueReminders(): Promise<ReminderSchedule[]> {
    // In a real implementation, this would query the database for reminders due now
    // For now, we'll return an empty array
    return Promise.resolve([]);
  }
}
