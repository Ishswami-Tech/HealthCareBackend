import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../../../../libs/infrastructure/cache/cache.service";
import { LoggingService } from "../../../../libs/infrastructure/logging";
import { AppointmentNotificationService } from "../notifications/appointment-notification.service";
import { PrismaService } from "@database/prisma/prisma.service";

export interface FollowUpPlan {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  followUpType: "routine" | "urgent" | "specialist" | "therapy" | "surgery";
  scheduledFor: Date;
  status: "scheduled" | "completed" | "cancelled" | "overdue";
  priority: "low" | "normal" | "high" | "urgent";
  instructions: string;
  medications?: string[];
  tests?: string[];
  restrictions?: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FollowUpTemplate {
  id: string;
  name: string;
  followUpType: string;
  daysAfter: number;
  instructions: string;
  isActive: boolean;
  clinicId?: string;
  conditions?: {
    appointmentType?: string[];
    diagnosis?: string[];
    ageRange?: { min: number; max: number };
  };
}

export interface FollowUpResult {
  success: boolean;
  followUpId: string;
  scheduledFor: Date;
  message?: string;
  error?: string;
}

export interface FollowUpReminder {
  id: string;
  followUpId: string;
  patientId: string;
  reminderType: "appointment" | "medication" | "test" | "instruction";
  scheduledFor: Date;
  status: "scheduled" | "sent" | "failed";
  message: string;
  channels: string[];
}

@Injectable()
export class AppointmentFollowUpService {
  private readonly logger = new Logger(AppointmentFollowUpService.name);
  private readonly FOLLOWUP_CACHE_TTL = 3600; // 1 hour
  private readonly TEMPLATE_CACHE_TTL = 7200; // 2 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly notificationService: AppointmentNotificationService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
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
    priority: string = "normal",
    medications?: string[],
    tests?: string[],
    restrictions?: string[],
    notes?: string,
  ): Promise<FollowUpResult> {
    const followUpId = `followup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scheduledFor = new Date(Date.now() + daysAfter * 24 * 60 * 60 * 1000);

    this.logger.log(`Creating follow-up plan ${followUpId}`, {
      appointmentId,
      followUpType,
      daysAfter,
      scheduledFor,
    });

    try {
      const followUpPlan: FollowUpPlan = {
        id: followUpId,
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        followUpType: followUpType as any,
        scheduledFor,
        status: "scheduled",
        priority: priority as any,
        instructions,
        medications,
        tests,
        restrictions,
        notes,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store follow-up plan in cache
      const cacheKey = `followup:${followUpId}`;
      await this.cacheService.set(
        cacheKey,
        followUpPlan,
        this.FOLLOWUP_CACHE_TTL,
      );

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
      this.logger.error(`Failed to create follow-up plan ${followUpId}`, {
        error: _error instanceof Error ? _error.message : "Unknown _error",
        appointmentId,
      });

      return {
        success: false,
        followUpId,
        scheduledFor,
        error: _error instanceof Error ? _error.message : "Unknown _error",
      };
    }
  }

  /**
   * Get follow-up plans for a patient
   */
  async getPatientFollowUps(
    patientId: string,
    clinicId: string,
    status?: string,
  ): Promise<FollowUpPlan[]> {
    const cacheKey = `patient_followups:${patientId}:${clinicId}:${status || "all"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as any;
      }

      // Get follow-up plans from database
      const followUps = await this.prisma.followUpPlan.findMany({
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
          scheduledFor: "asc",
        },
      });

      const followUpList: FollowUpPlan[] = followUps.map(
        (followUp: any) => ({
          id: followUp.id,
          appointmentId: followUp.appointmentId,
          patientId: followUp.patientId,
          doctorId: followUp.doctorId,
          clinicId: followUp.clinicId,
          followUpType: followUp.followUpType,
          scheduledFor: followUp.scheduledFor,
          status: followUp.status,
          priority: followUp.priority,
          instructions: followUp.instructions,
          medications: followUp.medications || [],
          tests: followUp.tests || [],
          restrictions: followUp.restrictions || [],
          notes: followUp.notes,
          createdAt: followUp.createdAt,
          updatedAt: followUp.updatedAt,
        }),
      );

      await this.cacheService.set(
        cacheKey,
        followUpList,
        this.FOLLOWUP_CACHE_TTL,
      );
      return followUpList;
    } catch (_error) {
      this.logger.error("Failed to get patient follow-ups", {
        error: _error instanceof Error ? _error.message : "Unknown _error",
        patientId,
      });
      return [];
    }
  }

  /**
   * Update follow-up plan status
   */
  async updateFollowUpStatus(
    followUpId: string,
    status: "scheduled" | "completed" | "cancelled" | "overdue",
    notes?: string,
  ): Promise<boolean> {
    try {
      const cacheKey = `followup:${followUpId}`;
      const followUp = await this.cacheService.get(cacheKey);

      if (!followUp) {
        this.logger.warn(`Follow-up ${followUpId} not found`);
        return false;
      }

      const updatedFollowUp = {
        ...followUp,
        status,
        notes: notes || (followUp as any).notes,
        updatedAt: new Date(),
      };

      await this.cacheService.set(
        cacheKey,
        updatedFollowUp,
        this.FOLLOWUP_CACHE_TTL,
      );

      this.logger.log(`Follow-up ${followUpId} status updated to ${status}`);
      return true;
    } catch (_error) {
      this.logger.error(`Failed to update follow-up status ${followUpId}`, {
        error: _error instanceof Error ? _error.message : "Unknown _error",
      });
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
        return cached as any;
      }

      // Mock follow-up templates
      const templates: FollowUpTemplate[] = [
        {
          id: "template_1",
          name: "Routine Follow-up",
          followUpType: "routine",
          daysAfter: 7,
          instructions: "Schedule follow-up appointment to monitor progress",
          isActive: true,
          conditions: {
            appointmentType: ["GENERAL_CONSULTATION", "FOLLOW_UP"],
          },
        },
        {
          id: "template_2",
          name: "Post-Surgery Follow-up",
          followUpType: "surgery",
          daysAfter: 14,
          instructions: "Post-surgery follow-up to check healing and recovery",
          isActive: true,
          conditions: {
            appointmentType: ["SURGERY"],
          },
        },
        {
          id: "template_3",
          name: "Therapy Follow-up",
          followUpType: "therapy",
          daysAfter: 3,
          instructions:
            "Follow-up on therapy progress and adjust treatment plan",
          isActive: true,
          conditions: {
            appointmentType: ["THERAPY"],
          },
        },
      ];

      await this.cacheService.set(cacheKey, templates, this.TEMPLATE_CACHE_TTL);
      return templates;
    } catch (_error) {
      this.logger.error("Failed to get follow-up templates", {
        error: _error instanceof Error ? _error.message : "Unknown _error",
        clinicId,
      });
      return [];
    }
  }

  /**
   * Create follow-up template
   */
  async createFollowUpTemplate(
    template: Omit<FollowUpTemplate, "id">,
  ): Promise<FollowUpTemplate> {
    const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTemplate: FollowUpTemplate = {
      id: templateId,
      ...template,
    };

    try {
      const cacheKey = `followup_templates:${template.clinicId || "default"}`;
      const existingTemplates = await this.getFollowUpTemplates(
        template.clinicId || "default",
      );
      const updatedTemplates = [...existingTemplates, newTemplate];

      await this.cacheService.set(
        cacheKey,
        updatedTemplates,
        this.TEMPLATE_CACHE_TTL,
      );

      this.logger.log(`Created follow-up template ${templateId}`, {
        name: template.name,
        followUpType: template.followUpType,
      });
      return newTemplate;
    } catch (_error) {
      this.logger.error(`Failed to create follow-up template`, {
        error: _error instanceof Error ? _error.message : "Unknown _error",
        templateName: template.name,
      });
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
        return cached as any;
      }

      // Mock overdue follow-ups
      const overdueFollowUps: FollowUpPlan[] = [
        {
          id: "followup_overdue_1",
          appointmentId: "appointment_1",
          patientId: "patient_1",
          doctorId: "doctor_1",
          clinicId,
          followUpType: "routine",
          scheduledFor: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
          status: "overdue",
          priority: "high",
          instructions: "Overdue follow-up appointment",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      await this.cacheService.set(
        cacheKey,
        overdueFollowUps,
        this.FOLLOWUP_CACHE_TTL,
      );
      return overdueFollowUps;
    } catch (_error) {
      this.logger.error("Failed to get overdue follow-ups", {
        error: _error instanceof Error ? _error.message : "Unknown _error",
        clinicId,
      });
      return [];
    }
  }

  /**
   * Schedule follow-up reminders
   */
  private async scheduleFollowUpReminders(
    followUp: FollowUpPlan,
  ): Promise<void> {
    this.logger.log(`Scheduling reminders for follow-up ${followUp.id}`, {
      scheduledFor: followUp.scheduledFor,
    });

    // Schedule reminder 1 day before
    const reminderDate = new Date(
      followUp.scheduledFor.getTime() - 24 * 60 * 60 * 1000,
    );

    if (reminderDate > new Date()) {
      await this.notificationService.scheduleNotification(
        {
          appointmentId: followUp.appointmentId,
          patientId: followUp.patientId,
          doctorId: followUp.doctorId,
          clinicId: followUp.clinicId,
          type: "follow_up",
          priority: followUp.priority,
          channels: ["email", "whatsapp", "push"] as (
            | "socket"
            | "push"
            | "email"
            | "sms"
            | "whatsapp"
          )[],
          templateData: {
            patientName: "Patient", // This should be fetched from user data
            doctorName: "Doctor", // This should be fetched from user data
            appointmentDate: followUp.scheduledFor.toISOString().split("T")[0],
            appointmentTime: "10:00", // This should be fetched from appointment data
            location: "Clinic", // This should be fetched from clinic data
            clinicName: "Healthcare Clinic", // This should be fetched from clinic data
            notes: followUp.instructions,
          },
        },
        reminderDate,
      );
    }
  }

  /**
   * Send follow-up notification
   */
  private async sendFollowUpNotification(
    followUp: FollowUpPlan,
  ): Promise<void> {
    this.logger.log(`Sending follow-up notification for ${followUp.id}`);

    try {
      const notificationData = {
        appointmentId: followUp.appointmentId,
        patientId: followUp.patientId,
        doctorId: followUp.doctorId,
        clinicId: followUp.clinicId,
        type: "follow_up" as const,
        priority: followUp.priority,
        channels: ["email", "whatsapp", "push"] as (
          | "socket"
          | "push"
          | "email"
          | "sms"
          | "whatsapp"
        )[],
        templateData: {
          patientName: "Patient", // This should be fetched from user data
          doctorName: "Doctor", // This should be fetched from user data
          appointmentDate: followUp.scheduledFor.toISOString().split("T")[0],
          appointmentTime: "10:00", // This should be fetched from appointment data
          location: "Clinic", // This should be fetched from clinic data
          clinicName: "Healthcare Clinic", // This should be fetched from clinic data
          notes: followUp.instructions,
        },
      };

      await this.notificationService.sendNotification(notificationData);
    } catch (_error) {
      this.logger.error(
        `Failed to send follow-up notification for ${followUp.id}`,
        {
          error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      );
    }
  }
}
