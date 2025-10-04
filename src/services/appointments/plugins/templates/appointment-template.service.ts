import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { PrismaService } from "../../../../libs/infrastructure/database/prisma/prisma.service";

export interface AppointmentTemplate {
  id: string;
  name: string;
  description?: string;
  clinicId: string;
  doctorId?: string;
  duration: number;
  type: string;
  recurringPattern: "daily" | "weekly" | "monthly" | "yearly";
  recurringDays?: number[];
  recurringInterval: number;
  startDate: Date;
  endDate?: Date;
  timeSlots: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringAppointmentSeries {
  id: string;
  templateId: string;
  patientId: string;
  clinicId: string;
  startDate: Date;
  endDate?: Date;
  status: "active" | "paused" | "cancelled";
  appointments: string[]; // appointment IDs
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AppointmentTemplateService {
  private readonly logger = new Logger(AppointmentTemplateService.name);
  private readonly TEMPLATE_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Create appointment template
   */
  async createTemplate(
    templateData: Omit<AppointmentTemplate, "id" | "createdAt" | "updatedAt">,
  ): Promise<AppointmentTemplate> {
    try {
      const template = await this.prisma.appointmentTemplate.create({
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
      });

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        description: template.description,
        clinicId: template.clinicId,
        doctorId: template.doctorId,
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots as string[],
        recurringPattern: template.recurringPattern as
          | "daily"
          | "weekly"
          | "monthly"
          | "yearly",
        recurringDays: template.recurringDays as number[],
        recurringInterval: template.recurringInterval,
        startDate: template.startDate,
        endDate: template.endDate,
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Cache the template
      const cacheKey = `appointment_template:${template.id}`;
      await this.cacheService.set(
        cacheKey,
        templateResult,
        this.TEMPLATE_CACHE_TTL,
      );

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

      // Get templates from database
      const templates = await this.prisma.appointmentTemplate.findMany({
        where: {
          clinicId,
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const templateList: AppointmentTemplate[] = templates.map(
        (template: unknown) => {
          const templateData = template as Record<string, unknown>;
          return {
            id: templateData.id as string,
            name: templateData.name as string,
            clinicId: templateData.clinicId as string,
            doctorId: templateData.doctorId as string,
            type: templateData.type as string,
            duration: templateData.duration as number,
            timeSlots: templateData.timeSlots as string[],
            recurringPattern: templateData.recurringPattern as
              | "daily"
              | "weekly"
              | "monthly"
              | "yearly",
            recurringDays: templateData.recurringDays as number[],
            recurringInterval: templateData.recurringInterval as number,
            startDate: templateData.startDate as string,
            endDate: templateData.endDate as string,
            isActive: templateData.isActive as boolean,
            createdAt: templateData.createdAt as string,
            updatedAt: templateData.updatedAt as string,
          };
        },
      );

      await this.cacheService.set(
        cacheKey,
        templateList,
        this.TEMPLATE_CACHE_TTL,
      );
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
    endDate?: Date,
  ): Promise<RecurringAppointmentSeries> {
    const seriesId = `series_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Get template
      const template = await this.getTemplate(templateId);
      if (!template) {
        throw new Error("Template not found");
      }

      // Generate appointments based on template
      const appointments = await this.generateAppointmentsFromTemplate(
        template,
        patientId,
        startDate,
        endDate,
      );

      const series: RecurringAppointmentSeries = {
        id: seriesId,
        templateId,
        patientId,
        clinicId,
        startDate,
        endDate,
        status: "active",
        appointments: appointments.map((apt) => apt.id),
        createdAt: new Date(),
        updatedAt: new Date(),
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

      // Get template from database
      const template = await this.prisma.appointmentTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return null;
      }

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        description: template.description,
        clinicId: template.clinicId,
        doctorId: template.doctorId,
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots as string[],
        recurringPattern: template.recurringPattern as
          | "daily"
          | "weekly"
          | "monthly"
          | "yearly",
        recurringDays: template.recurringDays as number[],
        recurringInterval: template.recurringInterval,
        startDate: template.startDate,
        endDate: template.endDate,
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Cache the template
      await this.cacheService.set(
        cacheKey,
        templateResult,
        this.TEMPLATE_CACHE_TTL,
      );

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
  private async generateAppointmentsFromTemplate(
    template: AppointmentTemplate,
    patientId: string,
    startDate: Date,
    endDate?: Date,
  ): Promise<any[]> {
    const appointments = [];
    const currentDate = new Date(startDate);
    const finalDate =
      endDate || new Date(currentDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year default

    while (currentDate <= finalDate) {
      // Check if current date matches recurring pattern
      if (this.matchesRecurringPattern(template, currentDate)) {
        for (const timeSlot of template.timeSlots) {
          const appointmentId = `apt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          appointments.push({
            id: appointmentId,
            patientId,
            doctorId: template.doctorId,
            clinicId: template.clinicId,
            date: currentDate.toISOString().split("T")[0],
            time: timeSlot,
            duration: template.duration,
            type: template.type,
            status: "SCHEDULED",
            isRecurring: true,
            templateId: template.id,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      // Move to next date based on pattern
      this.advanceDateByPattern(currentDate, template);
    }

    return appointments;
  }

  /**
   * Check if date matches recurring pattern
   */
  private matchesRecurringPattern(
    template: AppointmentTemplate,
    date: Date,
  ): boolean {
    switch (template.recurringPattern) {
      case "daily":
        return true;
      case "weekly":
        return template.recurringDays?.includes(date.getDay()) || false;
      case "monthly":
        return date.getDate() === template.startDate.getDate();
      case "yearly":
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
  private advanceDateByPattern(
    date: Date,
    template: AppointmentTemplate,
  ): void {
    switch (template.recurringPattern) {
      case "daily":
        date.setDate(date.getDate() + template.recurringInterval);
        break;
      case "weekly":
        date.setDate(date.getDate() + 7 * template.recurringInterval);
        break;
      case "monthly":
        date.setMonth(date.getMonth() + template.recurringInterval);
        break;
      case "yearly":
        date.setFullYear(date.getFullYear() + template.recurringInterval);
        break;
    }
  }

  /**
   * Update template
   */
  async updateTemplate(
    templateId: string,
    updateData: Partial<AppointmentTemplate>,
  ): Promise<AppointmentTemplate> {
    try {
      const template = await this.prisma.appointmentTemplate.update({
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
      });

      const templateResult: AppointmentTemplate = {
        id: template.id,
        name: template.name,
        description: template.description,
        clinicId: template.clinicId,
        doctorId: template.doctorId,
        type: template.type,
        duration: template.duration,
        timeSlots: template.timeSlots as string[],
        recurringPattern: template.recurringPattern as
          | "daily"
          | "weekly"
          | "monthly"
          | "yearly",
        recurringDays: template.recurringDays as number[],
        recurringInterval: template.recurringInterval,
        startDate: template.startDate,
        endDate: template.endDate,
        isActive: template.isActive,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      };

      // Update cache
      const cacheKey = `appointment_template:${templateId}`;
      await this.cacheService.set(
        cacheKey,
        templateResult,
        this.TEMPLATE_CACHE_TTL,
      );

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
      const template = await this.prisma.appointmentTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, clinicId: true, name: true },
      });

      if (!template) {
        return false;
      }

      // Delete from database
      await this.prisma.appointmentTemplate.delete({
        where: { id: templateId },
      });

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
  private async invalidateClinicTemplatesCache(
    clinicId: string,
  ): Promise<void> {
    const cacheKey = `clinic_templates:${clinicId}`;
    await this.cacheService.delete(cacheKey);
  }
}
