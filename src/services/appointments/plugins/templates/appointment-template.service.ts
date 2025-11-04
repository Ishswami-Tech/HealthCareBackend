import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { DatabaseService } from '@infrastructure/database';
import type {
  AppointmentTemplate,
  PrismaAppointmentTemplate,
  RecurringAppointmentSeries,
} from '@core/types/appointment.types';

@Injectable()
export class AppointmentTemplateService {
  private readonly logger = new Logger(AppointmentTemplateService.name);
  private readonly TEMPLATE_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Create appointment template
   */
  async createTemplate(
    templateData: Omit<AppointmentTemplate, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<AppointmentTemplate> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      const template = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              appointmentTemplate: { create: <T>(args: T) => Promise<AppointmentTemplate> };
            }
          ).appointmentTemplate.create({
            data: {
              name: templateData.name,
              description: templateData.description,
              clinicId: templateData.clinicId,
              doctorId: templateData.doctorId,
              type: templateData.type,
              duration: templateData.duration,
              timeSlots: templateData.timeSlots,
              recurringPattern: templateData.recurringPattern,
              recurringDays: templateData.recurringDays,
              recurringInterval: templateData.recurringInterval,
              startDate: templateData.startDate,
              endDate: templateData.endDate,
              isActive: templateData.isActive,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: templateData.clinicId || '',
          resourceType: 'APPOINTMENT_TEMPLATE',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: templateData.name, clinicId: templateData.clinicId },
        }
      );

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        ...(template.description && { description: template.description }),
        clinicId: template.clinicId,
        ...(template.doctorId && { doctorId: template.doctorId }),
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots,
        recurringPattern: template.recurringPattern ?? 'daily',
        ...(template.recurringDays && { recurringDays: template.recurringDays }),
        recurringInterval: template.recurringInterval ?? 1,
        startDate: template.startDate,
        ...(template.endDate && { endDate: template.endDate }),
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Cache the template
      const cacheKey = `appointment_template:${template.id}`;
      await this.cacheService.set(cacheKey, templateResult, this.TEMPLATE_CACHE_TTL);

      // Invalidate clinic templates cache
      await this.invalidateClinicTemplatesCache(templateData.clinicId);

      this.logger.log(`Created appointment template ${template.id}`, {
        name: templateData.name,
        clinicId: templateData.clinicId,
        type: templateData.type,
      });

      return templateResult;
    } catch (_error) {
      this.logger.error(`Failed to create appointment template`, {
        templateName: templateData.name,
        clinicId: templateData.clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get templates for clinic
   */
  async getClinicTemplates(clinicId: string): Promise<AppointmentTemplate[]> {
    const cacheKey = `clinic_templates:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as AppointmentTemplate[];
      }

      // Get templates from database using executeHealthcareRead
      const templates = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointmentTemplate: { findMany: <T>(args: T) => Promise<AppointmentTemplate[]> };
          }
        ).appointmentTemplate.findMany({
          where: {
            clinicId,
            isActive: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        } as never);
      })) as PrismaAppointmentTemplate[];

      const templateList: AppointmentTemplate[] = templates.map(
        (template: PrismaAppointmentTemplate) => {
          return {
            id: template.id,
            name: template.name,
            ...(template.description && { description: template.description }),
            clinicId: template.clinicId,
            ...(template.doctorId && { doctorId: template.doctorId }),
            type: template.type,
            duration: template.duration,
            timeSlots: template.timeSlots,
            recurringPattern:
              (template.recurringPattern as 'daily' | 'weekly' | 'monthly' | 'yearly') ?? 'daily',
            ...(template.recurringDays && { recurringDays: template.recurringDays }),
            recurringInterval: template.recurringInterval ?? 1,
            startDate: template.startDate,
            ...(template.endDate && { endDate: template.endDate }),
            isActive: template.isActive,
            createdAt: template.createdAt,
            updatedAt: template.updatedAt,
          };
        }
      );

      await this.cacheService.set(cacheKey, templateList, this.TEMPLATE_CACHE_TTL);
      return templateList;
    } catch (_error) {
      this.logger.error(`Failed to get clinic templates`, {
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Create recurring appointment series from template
   */
  async createRecurringSeries(
    templateId: string,
    patientId: string,
    clinicId: string,
    startDate: Date,
    endDate?: Date
  ): Promise<RecurringAppointmentSeries> {
    const seriesId = `series_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Get template
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Generate appointments based on template
      const appointments = await this.generateAppointmentsFromTemplate(
        template,
        patientId,
        startDate,
        endDate
      );

      const series: RecurringAppointmentSeries = {
        id: seriesId,
        templateId,
        patientId,
        clinicId,
        startDate,
        status: 'active',
        appointments: appointments,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(endDate && { endDate }),
      };

      // Cache the series
      const cacheKey = `appointment_series:${seriesId}`;
      await this.cacheService.set(cacheKey, series, this.TEMPLATE_CACHE_TTL);

      this.logger.log(`Created recurring appointment series ${seriesId}`, {
        templateId,
        patientId,
        clinicId,
        appointmentCount: appointments.length,
      });

      return series;
    } catch (_error) {
      this.logger.error(`Failed to create recurring series`, {
        templateId,
        patientId,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get template by ID
   */
  async getTemplate(templateId: string): Promise<AppointmentTemplate | null> {
    const cacheKey = `appointment_template:${templateId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AppointmentTemplate;
      }

      // Get template from database using executeHealthcareRead
      const template = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointmentTemplate: {
              findUnique: <T>(args: T) => Promise<AppointmentTemplate | null>;
            };
          }
        ).appointmentTemplate.findUnique({
          where: { id: templateId },
        } as never);
      });

      if (!template) {
        return null;
      }

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        ...(template.description && { description: template.description }),
        clinicId: template.clinicId,
        ...(template.doctorId && { doctorId: template.doctorId }),
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots,
        recurringPattern: template.recurringPattern ?? 'daily',
        ...(template.recurringDays && { recurringDays: template.recurringDays }),
        recurringInterval: template.recurringInterval ?? 1,
        startDate: template.startDate,
        ...(template.endDate && { endDate: template.endDate }),
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Cache the template
      await this.cacheService.set(cacheKey, templateResult, this.TEMPLATE_CACHE_TTL);

      return templateResult;
    } catch (_error) {
      this.logger.error(`Failed to get template`, {
        templateId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return null;
    }
  }

  /**
   * Generate appointments from template
   */
  private generateAppointmentsFromTemplate(
    template: AppointmentTemplate,
    patientId: string,
    startDate: Date,
    endDate?: Date
  ): Promise<string[]> {
    const appointments: string[] = [];
    const currentDate = new Date(startDate);
    const finalDate = endDate || new Date(currentDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year default

    while (currentDate <= finalDate) {
      // Check if current date matches recurring pattern
      if (this.matchesRecurringPattern(template, currentDate)) {
        for (const _timeSlot of template.timeSlots) {
          const appointmentId = `apt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          appointments.push(appointmentId);
        }
      }

      // Move to next date based on pattern
      this.advanceDateByPattern(currentDate, template);
    }

    return Promise.resolve(appointments);
  }

  /**
   * Check if date matches recurring pattern
   */
  private matchesRecurringPattern(template: AppointmentTemplate, date: Date): boolean {
    switch (template.recurringPattern) {
      case 'daily':
        return true;
      case 'weekly':
        return template.recurringDays?.includes(date.getDay()) || false;
      case 'monthly':
        return date.getDate() === template.startDate.getDate();
      case 'yearly':
        return (
          date.getMonth() === template.startDate.getMonth() &&
          date.getDate() === template.startDate.getDate()
        );
      default:
        return false;
    }
  }

  /**
   * Advance date by recurring pattern
   */
  private advanceDateByPattern(date: Date, template: AppointmentTemplate): void {
    switch (template.recurringPattern) {
      case 'daily':
        date.setDate(date.getDate() + template.recurringInterval);
        break;
      case 'weekly':
        date.setDate(date.getDate() + 7 * template.recurringInterval);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + template.recurringInterval);
        break;
      case 'yearly':
        date.setFullYear(date.getFullYear() + template.recurringInterval);
        break;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(
    templateId: string,
    updateData: Partial<AppointmentTemplate>
  ): Promise<AppointmentTemplate> {
    try {
      // Use executeHealthcareWrite for update with audit logging
      const template = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              appointmentTemplate: { update: <T>(args: T) => Promise<AppointmentTemplate> };
            }
          ).appointmentTemplate.update({
            where: { id: templateId },
            data: {
              name: updateData.name,
              description: updateData.description,
              type: updateData.type,
              duration: updateData.duration,
              timeSlots: updateData.timeSlots,
              recurringPattern: updateData.recurringPattern,
              recurringDays: updateData.recurringDays,
              recurringInterval: updateData.recurringInterval,
              startDate: updateData.startDate,
              endDate: updateData.endDate,
              isActive: updateData.isActive,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'APPOINTMENT_TEMPLATE',
          operation: 'UPDATE',
          resourceId: templateId,
          userRole: 'system',
          details: { updateFields: Object.keys(updateData) },
        }
      );

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        ...(template.description && { description: template.description }),
        clinicId: template.clinicId,
        ...(template.doctorId && { doctorId: template.doctorId }),
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots,
        recurringPattern: template.recurringPattern ?? 'daily',
        ...(template.recurringDays && { recurringDays: template.recurringDays }),
        recurringInterval: template.recurringInterval ?? 1,
        startDate: template.startDate,
        ...(template.endDate && { endDate: template.endDate }),
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Update cache
      const cacheKey = `appointment_template:${templateId}`;
      await this.cacheService.set(cacheKey, templateResult, this.TEMPLATE_CACHE_TTL);

      // Invalidate clinic templates cache

      await this.invalidateClinicTemplatesCache(template.clinicId);

      this.logger.log(`Updated template ${templateId}`, {
        updates: Object.keys(updateData),
      });

      return templateResult;
    } catch (_error) {
      this.logger.error(`Failed to update template`, {
        templateId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    try {
      // Use executeHealthcareRead first to get record for cache invalidation
      const template = (await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            appointmentTemplate: {
              findUnique: <T>(
                args: T
              ) => Promise<{ id: string; clinicId: string; name: string } | null>;
            };
          }
        ).appointmentTemplate.findUnique({
          where: { id: templateId },
          select: { id: true, clinicId: true, name: true },
        } as never);
      })) as { id: string; clinicId: string; name: string } | null;

      if (!template) {
        return false;
      }

      // Delete from database using executeHealthcareWrite with audit logging
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              appointmentTemplate: { delete: <T>(args: T) => Promise<AppointmentTemplate> };
            }
          ).appointmentTemplate.delete({
            where: { id: templateId },
          } as never);
        },
        {
          userId: 'system',
          clinicId: template.clinicId || '',
          resourceType: 'APPOINTMENT_TEMPLATE',
          operation: 'DELETE',
          resourceId: templateId,
          userRole: 'system',
          details: { name: template.name, clinicId: template.clinicId },
        }
      );

      // Remove from cache
      const cacheKey = `appointment_template:${templateId}`;
      await this.cacheService.delete(cacheKey);

      // Invalidate clinic templates cache

      await this.invalidateClinicTemplatesCache(template.clinicId);

      this.logger.log(`Deleted template ${templateId}`, {
        name: template.name,
        clinicId: template.clinicId,
      });

      return true;
    } catch (_error) {
      this.logger.error(`Failed to delete template`, {
        templateId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      return false;
    }
  }

  /**
   * Invalidate clinic templates cache
   */
  private async invalidateClinicTemplatesCache(clinicId: string): Promise<void> {
    const cacheKey = `clinic_templates:${clinicId}`;
    await this.cacheService.delete(cacheKey);
  }
}
