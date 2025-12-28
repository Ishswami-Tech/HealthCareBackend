/**
 * Clinic Template Service
 * =======================
 * Service for fetching clinic-specific template data for multi-tenant WhatsApp messaging
 * Provides clinic names, template IDs, and other clinic-specific data for communication templates
 *
 * @module ClinicTemplateService
 * @description Centralized clinic data fetching for communication templates
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { CommunicationConfigService } from '@communication/config/communication-config.service';

/**
 * Clinic template data structure
 */
export interface ClinicTemplateData {
  clinicId: string;
  clinicName: string;
  clinicLogo?: string;
  clinicPhone?: string;
  templateIds: {
    otp?: string;
    appointment?: string;
    reminder?: string;
    prescription?: string;
  };
}

/**
 * Clinic Template Service
 * Fetches clinic-specific data for communication templates
 */
@Injectable()
export class ClinicTemplateService {
  private readonly CACHE_TTL = 3600; // 1 hour cache

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CommunicationConfigService))
    private readonly communicationConfigService: CommunicationConfigService
  ) {}

  /**
   * Get complete clinic template data
   * Includes clinic name, logo, phone, and WhatsApp template IDs
   */
  async getClinicTemplateData(clinicId: string): Promise<ClinicTemplateData | null> {
    const cacheKey = `clinic_template_data:${clinicId}`;

    try {
      // Try cache first
      const cached = await this.cacheService.get<ClinicTemplateData>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch clinic data from database
      const clinic = await this.databaseService.executeHealthcareRead(async prisma => {
        return await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: {
            id: true,
            name: true,
            logo: true,
            phone: true,
          },
        });
      });

      if (!clinic) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Clinic not found: ${clinicId}`,
          'ClinicTemplateService',
          { clinicId }
        );
        return null;
      }

      // Fetch WhatsApp template IDs from communication config
      const commConfig = await this.communicationConfigService.getClinicConfig(clinicId);
      // Access templates via type assertion since the ProviderConfig type may not include templates
      const whatsappPrimary = commConfig?.whatsapp?.primary as
        | (Record<string, unknown> & { templates?: Record<string, string> })
        | undefined;
      const whatsappTemplates = whatsappPrimary?.templates;

      const templateData: ClinicTemplateData = {
        clinicId: clinic.id,
        clinicName: clinic.name || 'Healthcare Clinic',
        ...(clinic.logo && { clinicLogo: clinic.logo }),
        ...(clinic.phone && { clinicPhone: clinic.phone }),
        templateIds: {
          ...(whatsappTemplates?.['otp'] && { otp: whatsappTemplates['otp'] }),
          ...(whatsappTemplates?.['appointment'] && {
            appointment: whatsappTemplates['appointment'],
          }),
          ...(whatsappTemplates?.['reminder'] && { reminder: whatsappTemplates['reminder'] }),
          ...(whatsappTemplates?.['prescription'] && {
            prescription: whatsappTemplates['prescription'],
          }),
        },
      };

      // Cache for future use
      await this.cacheService.set(cacheKey, templateData, this.CACHE_TTL);

      return templateData;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic template data: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicTemplateService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Get clinic name only (lightweight method)
   */
  async getClinicName(clinicId: string): Promise<string> {
    const cacheKey = `clinic_name:${clinicId}`;

    try {
      // Try cache first
      const cached = await this.cacheService.get<string>(cacheKey);
      if (cached) {
        return cached;
      }

      // Fetch from database
      const clinic = await this.databaseService.executeHealthcareRead(async prisma => {
        return await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: { name: true },
        });
      });

      const clinicName = clinic?.name || 'Healthcare Clinic';

      // Cache for future use
      await this.cacheService.set(cacheKey, clinicName, this.CACHE_TTL);

      return clinicName;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to get clinic name: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicTemplateService',
        { clinicId }
      );
      return 'Healthcare Clinic'; // Fallback name
    }
  }

  /**
   * Get WhatsApp template ID for a specific template type
   */
  async getWhatsAppTemplateId(
    clinicId: string,
    templateType: 'otp' | 'appointment' | 'reminder' | 'prescription'
  ): Promise<string | null> {
    const templateData = await this.getClinicTemplateData(clinicId);
    if (!templateData) {
      return null;
    }

    return templateData.templateIds[templateType] || null;
  }

  /**
   * Invalidate clinic template cache
   */
  async invalidateCache(clinicId: string): Promise<void> {
    const cacheKeys = [`clinic_template_data:${clinicId}`, `clinic_name:${clinicId}`];

    await Promise.all(cacheKeys.map(key => this.cacheService.del(key)));
  }
}
