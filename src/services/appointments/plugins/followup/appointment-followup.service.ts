import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { AppointmentNotificationService } from '@services/appointments/plugins/notifications/appointment-notification.service';
import { DatabaseService } from '@infrastructure/database';
import type {
  FollowUpPlan,
  FollowUpTemplate,
  FollowUpResult,
  FollowUpReminder,
} from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { FollowUpPlan, FollowUpTemplate, FollowUpResult, FollowUpReminder };

@Injectable()
export class AppointmentFollowUpService {
  private readonly FOLLOWUP_CACHE_TTL = 3600; // 1 hour
  private readonly TEMPLATE_CACHE_TTL = 7200; // 2 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly notificationService: AppointmentNotificationService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Create a follow-up plan for an appointment
   */
  async createFollowUpPlan(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    clinicId: string,
    followUpType: string,
    daysAfter: number,
    instructions: string,
    priority: string = 'normal',
    medications?: string[],
    tests?: string[],
    restrictions?: string[],
    notes?: string
  ): Promise<FollowUpResult> {
    const followUpId = `followup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scheduledFor = new Date(Date.now() + daysAfter * 24 * 60 * 60 * 1000);

    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Creating follow-up plan ${followUpId}`,
      'AppointmentFollowUpService',
      {
        appointmentId,
        followUpType,
        daysAfter,
        scheduledFor,
      }
    );

    try {
      // Validate and cast followUpType to valid type
      const validFollowUpType: FollowUpPlan['followUpType'] =
        followUpType === 'routine' ||
        followUpType === 'urgent' ||
        followUpType === 'specialist' ||
        followUpType === 'therapy' ||
        followUpType === 'surgery'
          ? followUpType
          : 'routine';

      // Validate and cast priority to valid type
      const validPriority: FollowUpPlan['priority'] =
        priority === 'low' || priority === 'normal' || priority === 'high' || priority === 'urgent'
          ? priority
          : 'normal';

      const followUpPlan: FollowUpPlan = {
        id: followUpId,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType: validFollowUpType,
        scheduledFor,
        status: 'scheduled',
        priority: validPriority,
        instructions,
        medications: medications || [],
        tests: tests || [],
        restrictions: restrictions || [],
        notes: notes || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store follow-up plan in cache
      const cacheKey = `followup:${followUpId}`;
      await this.cacheService.set(cacheKey, followUpPlan, this.FOLLOWUP_CACHE_TTL);

      // Schedule follow-up reminders
      await this.scheduleFollowUpReminders(followUpPlan);

      // Send initial follow-up notification
      await this.sendFollowUpNotification(followUpPlan);

      return {
        success: true,
        followUpId,
        scheduledFor,
        message: `Follow-up plan created for ${scheduledFor.toISOString()}`,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up plan ${followUpId}`,
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
          appointmentId,
        }
      );

      return {
        success: false,
        followUpId,
        scheduledFor,
        error: _error instanceof Error ? _error.message : 'Unknown _error',
      };
    }
  }

  /**
   * Get follow-up plans for a patient
   */
  async getPatientFollowUps(
    patientId: string,
    clinicId: string,
    status?: string
  ): Promise<FollowUpPlan[]> {
    const cacheKey = `patient_followups:${patientId}:${clinicId}:${status || 'all'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as FollowUpPlan[];
      }

      // Get follow-up plans from database using executeHealthcareRead
      const followUps = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            followUpPlan: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).followUpPlan.findMany({
          where: {
            patientId,
            clinicId,
          },
          include: {
            appointment: {
              select: {
                id: true,
                date: true,
                doctor: {
                  select: {
                    id: true,
                    user: {
                      select: {
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: {
            scheduledFor: 'asc',
          },
        });
      });

      // Define interface for database row structure
      interface FollowUpRow {
        id: string;
        appointmentId: string;
        patientId: string;
        doctorId: string;
        clinicId: string;
        followUpType: string;
        scheduledFor: Date;
        status: string;
        priority: string;
        instructions: string;
        medications?: string[] | null;
        tests?: string[] | null;
        restrictions?: string[] | null;
        notes?: string | null;
        createdAt: Date;
        updatedAt: Date;
      }

      const followUpList: FollowUpPlan[] = followUps.map((followUp: unknown) => {
        const row = followUp as FollowUpRow;

        // Validate and cast followUpType
        const validFollowUpType: FollowUpPlan['followUpType'] =
          row.followUpType === 'routine' ||
          row.followUpType === 'urgent' ||
          row.followUpType === 'specialist' ||
          row.followUpType === 'therapy' ||
          row.followUpType === 'surgery'
            ? row.followUpType
            : 'routine';

        // Validate and cast priority
        const validPriority: FollowUpPlan['priority'] =
          row.priority === 'low' ||
          row.priority === 'normal' ||
          row.priority === 'high' ||
          row.priority === 'urgent'
            ? row.priority
            : 'normal';

        // Validate and cast status
        const validStatus: FollowUpPlan['status'] =
          row.status === 'scheduled' ||
          row.status === 'completed' ||
          row.status === 'cancelled' ||
          row.status === 'overdue'
            ? row.status
            : 'scheduled';

        return {
          id: row.id,
          appointmentId: row.appointmentId,
          patientId: row.patientId,
          doctorId: row.doctorId,
          clinicId: row.clinicId,
          followUpType: validFollowUpType,
          scheduledFor: row.scheduledFor,
          status: validStatus,
          priority: validPriority,
          instructions: row.instructions,
          medications: row.medications || [],
          tests: row.tests || [],
          restrictions: row.restrictions || [],
          notes: row.notes || '',
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      await this.cacheService.set(cacheKey, followUpList, this.FOLLOWUP_CACHE_TTL);
      return followUpList;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get patient follow-ups',
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
          patientId,
        }
      );
      return [];
    }
  }

  /**
   * Update follow-up plan status
   */
  async updateFollowUpStatus(
    followUpId: string,
    status: 'scheduled' | 'completed' | 'cancelled' | 'overdue',
    notes?: string
  ): Promise<boolean> {
    try {
      const cacheKey = `followup:${followUpId}`;
      const followUp = await this.cacheService.get(cacheKey);

      if (!followUp) {
        await this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.WARN,
          `Follow-up ${followUpId} not found`,
          'AppointmentFollowUpService'
        );
        return false;
      }

      const followUpPlan = followUp as FollowUpPlan;
      const updatedFollowUp: FollowUpPlan = {
        ...followUpPlan,
        status,
        notes: notes || followUpPlan.notes || '',
        updatedAt: new Date(),
      };

      await this.cacheService.set(cacheKey, updatedFollowUp, this.FOLLOWUP_CACHE_TTL);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Follow-up ${followUpId} status updated to ${status}`,
        'AppointmentFollowUpService'
      );
      return true;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up status ${followUpId}`,
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
      return false;
    }
  }

  /**
   * Get follow-up templates
   */
  async getFollowUpTemplates(clinicId: string): Promise<FollowUpTemplate[]> {
    const cacheKey = `followup_templates:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as FollowUpTemplate[];
      }

      // Mock follow-up templates
      const templates: FollowUpTemplate[] = [
        {
          id: 'template_1',
          name: 'Routine Follow-up',
          followUpType: 'routine',
          daysAfter: 7,
          instructions: 'Schedule follow-up appointment to monitor progress',
          isActive: true,
          conditions: {
            appointmentType: ['GENERAL_CONSULTATION', 'FOLLOW_UP'],
          },
        },
        {
          id: 'template_2',
          name: 'Post-Surgery Follow-up',
          followUpType: 'surgery',
          daysAfter: 14,
          instructions: 'Post-surgery follow-up to check healing and recovery',
          isActive: true,
          conditions: {
            appointmentType: ['SURGERY'],
          },
        },
        {
          id: 'template_3',
          name: 'Therapy Follow-up',
          followUpType: 'therapy',
          daysAfter: 3,
          instructions: 'Follow-up on therapy progress and adjust treatment plan',
          isActive: true,
          conditions: {
            appointmentType: ['THERAPY'],
          },
        },
      ];

      await this.cacheService.set(cacheKey, templates, this.TEMPLATE_CACHE_TTL);
      return templates;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get follow-up templates',
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
          clinicId,
        }
      );
      return [];
    }
  }

  /**
   * Create follow-up template
   */
  async createFollowUpTemplate(template: Omit<FollowUpTemplate, 'id'>): Promise<FollowUpTemplate> {
    const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTemplate: FollowUpTemplate = {
      id: templateId,
      ...template,
    };

    try {
      const cacheKey = `followup_templates:${template.clinicId || 'default'}`;
      const existingTemplates = await this.getFollowUpTemplates(template.clinicId || 'default');
      const updatedTemplates = [...existingTemplates, newTemplate];

      await this.cacheService.set(cacheKey, updatedTemplates, this.TEMPLATE_CACHE_TTL);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Created follow-up template ${templateId}`,
        'AppointmentFollowUpService',
        {
          name: template.name,
          followUpType: template.followUpType,
        }
      );
      return newTemplate;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up template`,
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
          templateName: template.name,
        }
      );
      throw _error;
    }
  }

  /**
   * Get overdue follow-ups
   */
  async getOverdueFollowUps(clinicId: string): Promise<FollowUpPlan[]> {
    const cacheKey = `overdue_followups:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as FollowUpPlan[];
      }

      // Mock overdue follow-ups
      const overdueFollowUps: FollowUpPlan[] = [
        {
          id: 'followup_overdue_1',
          appointmentId: 'appointment_1',
          patientId: 'patient_1',
          doctorId: 'doctor_1',
          clinicId,
          followUpType: 'routine',
          scheduledFor: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          status: 'overdue',
          priority: 'high',
          instructions: 'Overdue follow-up appointment',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      await this.cacheService.set(cacheKey, overdueFollowUps, this.FOLLOWUP_CACHE_TTL);
      return overdueFollowUps;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get overdue follow-ups',
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
          clinicId,
        }
      );
      return [];
    }
  }

  /**
   * Schedule follow-up reminders
   */
  private async scheduleFollowUpReminders(followUp: FollowUpPlan): Promise<void> {
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Scheduling reminders for follow-up ${followUp.id}`,
      'AppointmentFollowUpService',
      {
        scheduledFor: followUp.scheduledFor,
      }
    );

    // Schedule reminder 1 day before
    const reminderDate = new Date(followUp.scheduledFor.getTime() - 24 * 60 * 60 * 1000);

    if (reminderDate > new Date()) {
      await this.notificationService.scheduleNotification(
        {
          appointmentId: followUp.appointmentId,
          patientId: followUp.patientId,
          doctorId: followUp.doctorId,
          clinicId: followUp.clinicId,
          type: 'follow_up',
          priority: followUp.priority,
          channels: ['email', 'whatsapp', 'push'] as (
            | 'socket'
            | 'push'
            | 'email'
            | 'sms'
            | 'whatsapp'
          )[],
          templateData: {
            patientName: 'Patient', // This should be fetched from user data
            doctorName: 'Doctor', // This should be fetched from user data
            appointmentDate: followUp.scheduledFor.toISOString().split('T')[0] || '',
            appointmentTime: '10:00', // This should be fetched from appointment data
            location: 'Clinic', // This should be fetched from clinic data
            clinicName: 'Healthcare Clinic', // This should be fetched from clinic data
            notes: followUp.instructions,
          },
        },
        reminderDate
      );
    }
  }

  /**
   * Send follow-up notification
   */
  private async sendFollowUpNotification(followUp: FollowUpPlan): Promise<void> {
    await this.loggingService.log(
      LogType.BUSINESS,
      LogLevel.INFO,
      `Sending follow-up notification for ${followUp.id}`,
      'AppointmentFollowUpService'
    );

    try {
      const notificationData = {
        appointmentId: followUp.appointmentId || '',
        patientId: followUp.patientId,
        doctorId: followUp.doctorId,
        clinicId: followUp.clinicId,
        type: 'follow_up' as const,
        priority: followUp.priority,
        channels: ['email', 'whatsapp', 'push'] as (
          | 'socket'
          | 'push'
          | 'email'
          | 'sms'
          | 'whatsapp'
        )[],
        templateData: {
          patientName: 'Patient', // This should be fetched from user data
          doctorName: 'Doctor', // This should be fetched from user data
          appointmentDate: followUp.scheduledFor.toISOString().split('T')[0] || '',
          appointmentTime: '10:00', // This should be fetched from appointment data
          location: 'Clinic', // This should be fetched from clinic data
          clinicName: 'Healthcare Clinic', // This should be fetched from clinic data
          notes: followUp.instructions,
        },
      };

      await this.notificationService.sendNotification(notificationData);
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send follow-up notification for ${followUp.id}`,
        'AppointmentFollowUpService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown _error',
        }
      );
    }
  }
}
