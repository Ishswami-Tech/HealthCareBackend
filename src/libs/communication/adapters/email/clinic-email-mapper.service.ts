/**
 * Clinic Email Mapper Service
 * ============================
 * Maps SES source email addresses to clinic IDs for multi-tenant support
 * Helps identify which clinic an email belongs to when processing SES webhooks
 *
 * @module ClinicEmailMapperService
 * @description Clinic email mapping service for multi-tenant SES
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CommunicationConfigService } from '@communication/config';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { CacheService } from '@infrastructure/cache/cache.service';

/**
 * Clinic Email Mapper Service
 * Maps email addresses to clinic IDs based on clinic communication configuration
 */
@Injectable()
export class ClinicEmailMapperService {
  private readonly cacheTTL = 3600; // 1 hour
  private readonly cachePrefix = 'clinic:email:map:';

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CommunicationConfigService))
    private readonly communicationConfigService: CommunicationConfigService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Find clinic ID by SES source email address
   * Checks clinic communication configurations to find matching fromEmail
   */
  async findClinicBySourceEmail(sourceEmail: string): Promise<string | null> {
    const normalizedEmail = sourceEmail.toLowerCase().trim();
    const cacheKey = `${this.cachePrefix}${normalizedEmail}`;

    try {
      // Check cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as string;
      }

      // Find clinic by checking all clinic configurations
      const clinicId = await this.findClinicInDatabase(normalizedEmail);

      if (clinicId) {
        // Cache the result
        await this.cacheService.set(cacheKey, clinicId, this.cacheTTL);
      }

      return clinicId;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to find clinic by source email: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicEmailMapperService',
        {
          sourceEmail: normalizedEmail,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Find clinic in database by checking communication configurations
   */
  private async findClinicInDatabase(sourceEmail: string): Promise<string | null> {
    try {
      // Get all clinics with communication settings
      const clinics = await this.databaseService.executeHealthcareRead(async client => {
        const clinicClient = client as unknown as {
          clinic: {
            findMany: (args: {
              where: { isActive: boolean };
              select: { id: true; name: true; email: true; settings: true };
            }) => Promise<Array<{ id: string; name: string; email: string; settings: unknown }>>;
          };
        };
        return await clinicClient.clinic.findMany({
          where: {
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            settings: true,
          },
        });
      });

      // Check each clinic's communication configuration
      for (const clinic of clinics) {
        if (!clinic.settings || typeof clinic.settings !== 'object') {
          continue;
        }

        const settings = clinic.settings as Record<string, unknown>;
        const communicationSettings = settings['communicationSettings'];

        if (!communicationSettings || typeof communicationSettings !== 'object') {
          continue;
        }

        const commSettings = communicationSettings as Record<string, unknown>;
        const emailConfig = commSettings['email'];

        if (!emailConfig || typeof emailConfig !== 'object') {
          continue;
        }

        const email = emailConfig as Record<string, unknown>;

        // Check primary provider
        const primary = email['primary'] as Record<string, unknown> | undefined;
        if (primary) {
          const credentials = primary['credentials'] as Record<string, string> | undefined;
          if (credentials) {
            const fromEmail = credentials['fromEmail'] || credentials['from'];
            if (fromEmail && fromEmail.toLowerCase().trim() === sourceEmail) {
              return clinic.id;
            }
          }

          // Also check defaultFrom
          const defaultFrom = email['defaultFrom'] as string | undefined;
          if (defaultFrom && defaultFrom.toLowerCase().trim() === sourceEmail) {
            return clinic.id;
          }
        }

        // Check fallback providers
        const fallback = email['fallback'] as Array<Record<string, unknown>> | undefined;
        if (fallback && Array.isArray(fallback)) {
          for (const fallbackConfig of fallback) {
            const fallbackCredentials = fallbackConfig['credentials'] as
              | Record<string, string>
              | undefined;
            if (fallbackCredentials) {
              const fallbackFromEmail =
                fallbackCredentials['fromEmail'] || fallbackCredentials['from'];
              if (fallbackFromEmail && fallbackFromEmail.toLowerCase().trim() === sourceEmail) {
                return clinic.id;
              }
            }
          }
        }
      }

      return null;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to find clinic in database: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicEmailMapperService',
        {
          sourceEmail,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Invalidate cache for a clinic (when configuration changes)
   */
  async invalidateClinicCache(clinicId: string): Promise<void> {
    try {
      // Get clinic config to find all email addresses
      const config = await this.communicationConfigService.getClinicConfig(clinicId);
      if (!config) {
        return;
      }

      // Invalidate cache for all email addresses used by this clinic
      const emailsToInvalidate: string[] = [];

      if (config.email.primary?.credentials) {
        const creds = config.email.primary.credentials as Record<string, string>;
        const fromEmail = creds['fromEmail'] || creds['from'];
        if (fromEmail) {
          emailsToInvalidate.push(fromEmail.toLowerCase().trim());
        }
      }

      if (config.email.defaultFrom) {
        emailsToInvalidate.push(config.email.defaultFrom.toLowerCase().trim());
      }

      if (config.email.fallback) {
        for (const fallback of config.email.fallback) {
          if (fallback.credentials && typeof fallback.credentials === 'object') {
            const creds = fallback.credentials as Record<string, string>;
            const fromEmail = creds['fromEmail'] || creds['from'];
            if (fromEmail) {
              emailsToInvalidate.push(fromEmail.toLowerCase().trim());
            }
          }
        }
      }

      // Delete cache entries
      for (const email of emailsToInvalidate) {
        const cacheKey = `${this.cachePrefix}${email}`;
        await this.cacheService.delete(cacheKey);
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Failed to invalidate clinic cache: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicEmailMapperService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }
}
