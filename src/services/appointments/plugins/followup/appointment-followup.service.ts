import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { AppointmentNotificationService } from '../notifications/appointment-notification.service';
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

      // CRITICAL FIX: Persist to database FIRST, then cache (single source of truth)
      // This ensures data persistence even if cache expires
      // Follows CacheService pattern: database is source of truth, cache is optimization layer
      const followUpPlanData = {
        id: followUpId,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType: validFollowUpType,
        scheduledFor,
        daysAfter,
        status: 'scheduled' as const,
        priority: validPriority,
        instructions,
        medications: medications || [],
        tests: tests || [],
        restrictions: restrictions || [],
        notes: notes || '',
      };

      // 1. Create in database FIRST (source of truth)
      const followUpPlan = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              followUpPlan: {
                create: <T>(args: T) => Promise<unknown>;
              };
            }
          ).followUpPlan.create({
            data: followUpPlanData,
          });
        },
        {
          userId: doctorId,
          userRole: 'DOCTOR',
          clinicId,
          operation: 'CREATE_FOLLOWUP_PLAN',
          resourceType: 'FOLLOWUP_PLAN',
          resourceId: followUpId,
          timestamp: new Date(),
        }
      );

      // 2. Cache for performance (optimization layer)
      const cacheKey = `followup:${followUpId}`;
      await this.cacheService.set(cacheKey, followUpPlan, this.FOLLOWUP_CACHE_TTL);

      // 3. Invalidate patient follow-ups cache to ensure fresh data
      await this.cacheService.invalidateCacheByPattern(
        `patient_followups:${patientId}:${clinicId}:*`
      );

      // Schedule follow-up reminders
      await this.scheduleFollowUpReminders(followUpPlan as FollowUpPlan);

      // Send initial follow-up notification
      await this.sendFollowUpNotification(followUpPlan as FollowUpPlan);

      return {
        success: true,
        followUpId,
        scheduledFor,
        message: `Follow-up plan created for ${scheduledFor.toISOString()}`,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up plan ${followUpId}`,
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          appointmentId,
        }
      );

      return {
        success: false,
        followUpId,
        scheduledFor,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get follow-up plans for a patient with pagination
   * Optimized for 10M+ users: Cursor-based pagination prevents loading all records
   */
  async getPatientFollowUps(
    patientId: string,
    clinicId: string,
    status?: string,
    options?: {
      cursor?: string;
      limit?: number;
      includeCompleted?: boolean;
    }
  ): Promise<{
    data: FollowUpPlan[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = options?.limit || 20; // Default page size (optimized for 10M+ users)
    const cursor = options?.cursor;
    const cacheKey = `patient_followups:${patientId}:${clinicId}:${status || 'all'}:${cursor || 'first'}:${limit}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as { data: FollowUpPlan[]; nextCursor: string | null; hasMore: boolean };
      }

      // Get follow-up plans from database using executeHealthcareRead with pagination
      // Uses cursor-based pagination (O(1)) instead of offset (O(N)) for better performance
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
            ...(status && { status }),
            ...(options?.includeCompleted === false && {
              status: { not: 'completed' },
            }),
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
          take: limit + 1, // Take one extra to detect if there are more
          ...(cursor && { cursor: { id: cursor }, skip: 1 }), // Cursor-based pagination
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

      // Cursor-based pagination: Check if there are more results
      const hasMore = followUpList.length > limit;
      const data = hasMore ? followUpList.slice(0, limit) : followUpList;
      const nextCursor = hasMore ? data[data.length - 1]?.id || null : null;

      const result = { data, nextCursor, hasMore };

      // Cache paginated result
      await this.cacheService.set(cacheKey, result, this.FOLLOWUP_CACHE_TTL);
      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get patient follow-ups',
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          patientId,
        }
      );
      return { data: [], nextCursor: null, hasMore: false };
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
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up status ${followUpId}`,
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return false;
    }
  }

  /**
   * Update a follow-up plan with all fields
   */
  async updateFollowUpPlan(
    followUpId: string,
    updateData: {
      scheduledFor?: Date | string;
      followUpType?: string;
      instructions?: string;
      priority?: string;
      medications?: string[];
      tests?: string[];
      restrictions?: string[];
      notes?: string;
      status?: 'scheduled' | 'completed' | 'cancelled' | 'overdue';
    }
  ): Promise<FollowUpPlan | null> {
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
        return null;
      }

      const followUpPlan = followUp as FollowUpPlan;

      // Validate and cast followUpType if provided
      const validFollowUpType: FollowUpPlan['followUpType'] | undefined =
        updateData.followUpType &&
        (updateData.followUpType === 'routine' ||
          updateData.followUpType === 'urgent' ||
          updateData.followUpType === 'specialist' ||
          updateData.followUpType === 'therapy' ||
          updateData.followUpType === 'surgery')
          ? updateData.followUpType
          : undefined;

      // Validate and cast priority if provided
      const validPriority: FollowUpPlan['priority'] | undefined =
        updateData.priority &&
        (updateData.priority === 'low' ||
          updateData.priority === 'normal' ||
          updateData.priority === 'high' ||
          updateData.priority === 'urgent')
          ? updateData.priority
          : undefined;

      // Validate and cast status if provided
      const validStatus: FollowUpPlan['status'] | undefined =
        updateData.status &&
        (updateData.status === 'scheduled' ||
          updateData.status === 'completed' ||
          updateData.status === 'cancelled' ||
          updateData.status === 'overdue')
          ? updateData.status
          : undefined;

      const updatedFollowUp: FollowUpPlan = {
        ...followUpPlan,
        ...(updateData.scheduledFor && {
          scheduledFor:
            typeof updateData.scheduledFor === 'string'
              ? new Date(updateData.scheduledFor)
              : updateData.scheduledFor,
        }),
        ...(validFollowUpType && { followUpType: validFollowUpType }),
        ...(updateData.instructions && { instructions: updateData.instructions }),
        ...(validPriority && { priority: validPriority }),
        ...(updateData.medications && { medications: updateData.medications }),
        ...(updateData.tests && { tests: updateData.tests }),
        ...(updateData.restrictions && { restrictions: updateData.restrictions }),
        ...(updateData.notes !== undefined && { notes: updateData.notes }),
        ...(validStatus && { status: validStatus }),
        updatedAt: new Date(),
      };

      await this.cacheService.set(cacheKey, updatedFollowUp, this.FOLLOWUP_CACHE_TTL);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Follow-up ${followUpId} updated`,
        'AppointmentFollowUpService',
        {
          followUpId,
          updates: Object.keys(updateData),
        }
      );

      return updatedFollowUp;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update follow-up plan ${followUpId}`,
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return null;
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
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get follow-up templates',
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
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
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create follow-up template`,
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          templateName: template.name,
        }
      );
      throw error;
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
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get overdue follow-ups',
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
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
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send follow-up notification for ${followUp.id}`,
        'AppointmentFollowUpService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }
}
