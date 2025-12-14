/**
 * Payment Config Service
 * ======================
 * Manages per-clinic payment provider configuration
 * Handles credential encryption, caching, and fallback logic
 *
 * @module PaymentConfigService
 * @description Multi-tenant payment configuration service
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from './config.service';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { CredentialEncryptionService } from '@communication/config/credential-encryption.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import type { ClinicPaymentConfig } from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';

/**
 * Payment Config Service
 * Manages per-clinic payment provider configuration
 */
@Injectable()
export class PaymentConfigService implements OnModuleInit {
  private readonly logger = new Logger(PaymentConfigService.name);
  private readonly cacheTTL = 3600; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.logger.log('PaymentConfigService initialized');
  }

  /**
   * Get clinic payment configuration
   */
  async getClinicConfig(clinicId: string): Promise<ClinicPaymentConfig | null> {
    const cacheKey = `payment:config:${clinicId}`;

    try {
      // Try cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        const config = JSON.parse(cached as string) as ClinicPaymentConfig;
        // Decrypt credentials
        return await this.decryptConfig(config);
      }

      // Fetch from database
      const config = await this.fetchFromDatabase(clinicId);
      if (!config) {
        // Return default config if none exists
        return this.getDefaultConfig(clinicId);
      }

      // Decrypt credentials
      const decryptedConfig = await this.decryptConfig(config);

      // Cache for future use
      await this.cacheService.set(cacheKey, JSON.stringify(config), this.cacheTTL);

      return decryptedConfig;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic payment config: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentConfigService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      // Return default config on error
      return this.getDefaultConfig(clinicId);
    }
  }

  /**
   * Save clinic payment configuration
   */
  async saveClinicConfig(config: ClinicPaymentConfig): Promise<void> {
    const cacheKey = `payment:config:${config.clinicId}`;

    try {
      // Encrypt credentials before saving
      const encryptedConfig = await this.encryptConfig(config);

      // Save to database
      await this.saveToDatabase(encryptedConfig);

      // Invalidate cache
      await this.cacheService.delete(cacheKey);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Saved clinic payment config: ${config.clinicId}`,
        'PaymentConfigService',
        {
          clinicId: config.clinicId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to save clinic payment config: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentConfigService',
        {
          clinicId: config.clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get default configuration (fallback)
   */
  private getDefaultConfig(clinicId: string): ClinicPaymentConfig {
    return {
      clinicId,
      payment: {
        primary: {
          provider: PaymentProvider.RAZORPAY,
          enabled: true,
          credentials: {},
          priority: 1,
        },
        defaultCurrency: 'INR',
        defaultProvider: PaymentProvider.RAZORPAY,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Fetch configuration from database
   * Reads from Clinic.settings.paymentSettings (JSONB field)
   */
  private async fetchFromDatabase(clinicId: string): Promise<ClinicPaymentConfig | null> {
    try {
      const clinic = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.findUnique({
          where: { id: clinicId },
          select: { settings: true },
        });
      });

      if (!clinic?.settings || typeof clinic.settings !== 'object') {
        return null;
      }

      const settings = clinic.settings as Record<string, unknown>;
      const paymentSettings = settings['paymentSettings'];

      if (!paymentSettings || typeof paymentSettings !== 'object') {
        return null;
      }

      // Map to ClinicPaymentConfig format
      const config = paymentSettings as unknown as Omit<
        ClinicPaymentConfig,
        'clinicId' | 'createdAt' | 'updatedAt'
      >;

      return {
        clinicId,
        ...config,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to fetch payment config from database: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentConfigService.fetchFromDatabase',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Save configuration to database
   * Writes to Clinic.settings.paymentSettings (JSONB field)
   */
  private async saveToDatabase(config: ClinicPaymentConfig): Promise<void> {
    try {
      // Get current clinic settings to preserve other settings
      const currentClinic = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.findUnique({
          where: { id: config.clinicId },
          select: { settings: true },
        });
      });

      const currentSettings =
        currentClinic?.settings && typeof currentClinic.settings === 'object'
          ? (currentClinic.settings as Record<string, unknown>)
          : {};

      // Prepare payment settings (exclude clinicId, createdAt, updatedAt from JSON)
      const { clinicId: _clinicId, ...paymentSettings } = config;
      const updatedSettings = {
        ...currentSettings,
        paymentSettings: {
          ...paymentSettings,
          updatedAt: new Date().toISOString(),
          createdAt: paymentSettings.createdAt
            ? new Date(paymentSettings.createdAt).toISOString()
            : new Date().toISOString(),
        },
      };

      // Save to database with audit trail
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinic.update({
            where: { id: config.clinicId },
            data: {
              settings: updatedSettings as never, // Prisma Json type
            },
          });
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: config.clinicId,
          operation: 'UPDATE_PAYMENT_CONFIG',
          resourceType: 'PAYMENT_CONFIG',
          resourceId: config.clinicId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to save payment config to database: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentConfigService.saveToDatabase',
        {
          clinicId: config.clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Encrypt credentials in configuration
   */
  private async encryptConfig(config: ClinicPaymentConfig): Promise<ClinicPaymentConfig> {
    const encrypted = { ...config };

    // Encrypt payment credentials
    if (
      encrypted.payment.primary?.credentials &&
      !('encrypted' in encrypted.payment.primary.credentials)
    ) {
      const plainCreds = encrypted.payment.primary.credentials;
      const encryptedCreds = await this.credentialEncryption.encryptObject(plainCreds);
      encrypted.payment.primary.credentials = { encrypted: encryptedCreds };
    }

    // Encrypt fallback credentials
    if (encrypted.payment.fallback) {
      for (const fallback of encrypted.payment.fallback) {
        if (fallback.credentials && !('encrypted' in fallback.credentials)) {
          const plainCreds = fallback.credentials;
          const encryptedCreds = await this.credentialEncryption.encryptObject(plainCreds);
          fallback.credentials = { encrypted: encryptedCreds };
        }
      }
    }

    return encrypted;
  }

  /**
   * Decrypt credentials in configuration
   */
  private async decryptConfig(config: ClinicPaymentConfig): Promise<ClinicPaymentConfig> {
    const decrypted = { ...config };

    // Decrypt payment credentials
    if (
      decrypted.payment.primary?.credentials &&
      'encrypted' in decrypted.payment.primary.credentials
    ) {
      const decryptedCreds = await this.credentialEncryption.decryptObject<Record<string, string>>(
        decrypted.payment.primary.credentials.encrypted
      );
      decrypted.payment.primary.credentials = decryptedCreds;
    }

    // Decrypt fallback credentials
    if (decrypted.payment.fallback) {
      for (const fallback of decrypted.payment.fallback) {
        if (fallback.credentials && 'encrypted' in fallback.credentials) {
          const decryptedCreds = await this.credentialEncryption.decryptObject<
            Record<string, string>
          >(fallback.credentials.encrypted);
          fallback.credentials = decryptedCreds;
        }
      }
    }

    return decrypted;
  }
}
