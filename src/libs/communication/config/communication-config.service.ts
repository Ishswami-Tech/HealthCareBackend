/**
 * Communication Config Service
 * =============================
 * Manages per-clinic communication provider configuration
 * Handles credential encryption, caching, and fallback logic
 *
 * @module CommunicationConfigService
 * @description Multi-tenant communication configuration service
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { CredentialEncryptionService } from './credential-encryption.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import type { EmailResult } from '@communication/adapters/interfaces/email-provider.adapter';

/**
 * Communication Provider Type
 */
export enum CommunicationProviderType {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
}

/**
 * Email Provider
 */
export enum EmailProvider {
  SMTP = 'smtp',
  AWS_SES = 'aws_ses',
  SENDGRID = 'sendgrid',
  MAILGUN = 'mailgun',
  POSTMARK = 'postmark',
  MAILTRAP = 'mailtrap', // Dev/Staging only
}

/**
 * WhatsApp Provider
 */
export enum WhatsAppProvider {
  META_BUSINESS = 'meta_business',
  TWILIO = 'twilio',
  MESSAGEBIRD = 'messagebird',
  VONAGE = 'vonage',
}

/**
 * SMS Provider
 */
export enum SMSProvider {
  TWILIO = 'twilio',
  AWS_SNS = 'aws_sns',
  MESSAGEBIRD = 'messagebird',
  VONAGE = 'vonage',
}

/**
 * Provider Configuration
 */
export interface ProviderConfig {
  provider: EmailProvider | WhatsAppProvider | SMSProvider;
  enabled: boolean;
  credentials: Record<string, string> | { encrypted: string }; // Encrypted or plain
  settings?: Record<string, unknown>;
  priority?: number; // Lower number = higher priority
}

/**
 * Clinic Communication Configuration
 */
export interface ClinicCommunicationConfig {
  clinicId: string;
  email: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultFrom?: string;
    defaultFromName?: string;
  };
  whatsapp: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultNumber?: string;
  };
  sms: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultNumber?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Communication Config Service
 * Manages per-clinic communication provider configuration
 */
@Injectable()
export class CommunicationConfigService implements OnModuleInit {
  private readonly logger = new Logger(CommunicationConfigService.name);
  private readonly cacheTTL = 3600; // 1 hour

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.logger.log('CommunicationConfigService initialized');
  }

  /**
   * Get clinic communication configuration
   */
  async getClinicConfig(clinicId: string): Promise<ClinicCommunicationConfig | null> {
    const cacheKey = `communication:config:${clinicId}`;

    try {
      // Try cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        const config = JSON.parse(cached as string) as ClinicCommunicationConfig;
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
        `Failed to get clinic communication config: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService',
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
   * Save clinic communication configuration
   */
  async saveClinicConfig(config: ClinicCommunicationConfig): Promise<void> {
    const cacheKey = `communication:config:${config.clinicId}`;

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
        `Saved clinic communication config: ${config.clinicId}`,
        'CommunicationConfigService',
        {
          clinicId: config.clinicId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to save clinic communication config: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService',
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
  private getDefaultConfig(clinicId: string): ClinicCommunicationConfig {
    return {
      clinicId,
      email: {
        primary: {
          provider: EmailProvider.AWS_SES,
          enabled: true,
          credentials: {},
          priority: 1,
        },
      },
      whatsapp: {
        primary: {
          provider: WhatsAppProvider.META_BUSINESS,
          enabled: true,
          credentials: {},
          priority: 1,
        },
      },
      sms: {
        primary: {
          provider: SMSProvider.AWS_SNS,
          enabled: true,
          credentials: {},
          priority: 1,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Fetch configuration from database
   * Reads from Clinic.settings.communicationSettings (JSONB field)
   */
  private async fetchFromDatabase(clinicId: string): Promise<ClinicCommunicationConfig | null> {
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
      // Use bracket notation for index signature access
      const communicationSettings = settings['communicationSettings'];

      if (!communicationSettings || typeof communicationSettings !== 'object') {
        return null;
      }

      // Map to ClinicCommunicationConfig format
      // Omit excludes createdAt and updatedAt, so we create new ones
      const config = communicationSettings as unknown as Omit<
        ClinicCommunicationConfig,
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
        `Failed to fetch communication config from database: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService.fetchFromDatabase',
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
   * Writes to Clinic.settings.communicationSettings (JSONB field)
   * Preserves other settings when updating
   */
  private async saveToDatabase(config: ClinicCommunicationConfig): Promise<void> {
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

      // Prepare communication settings (exclude clinicId, createdAt, updatedAt from JSON)
      const { clinicId: _clinicId, ...communicationSettings } = config;
      const updatedSettings = {
        ...currentSettings,
        communicationSettings: {
          ...communicationSettings,
          updatedAt: new Date().toISOString(),
          createdAt: communicationSettings.createdAt
            ? new Date(communicationSettings.createdAt).toISOString()
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
          userId: 'system', // TODO: Get from context when available
          userRole: 'SYSTEM',
          clinicId: config.clinicId,
          operation: 'UPDATE_COMMUNICATION_CONFIG',
          resourceType: 'COMMUNICATION_CONFIG',
          resourceId: config.clinicId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to save communication config to database: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService.saveToDatabase',
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
  private async encryptConfig(
    config: ClinicCommunicationConfig
  ): Promise<ClinicCommunicationConfig> {
    const encrypted = { ...config };

    // Encrypt email credentials
    if (
      encrypted.email.primary?.credentials &&
      !('encrypted' in encrypted.email.primary.credentials)
    ) {
      const plainCreds = encrypted.email.primary.credentials;
      const encryptedCreds = await this.credentialEncryption.encryptObject(plainCreds);
      encrypted.email.primary.credentials = { encrypted: encryptedCreds };
    }

    // Encrypt WhatsApp credentials
    if (
      encrypted.whatsapp.primary?.credentials &&
      !('encrypted' in encrypted.whatsapp.primary.credentials)
    ) {
      const plainCreds = encrypted.whatsapp.primary.credentials;
      const encryptedCreds = await this.credentialEncryption.encryptObject(plainCreds);
      encrypted.whatsapp.primary.credentials = { encrypted: encryptedCreds };
    }

    // Encrypt SMS credentials
    if (encrypted.sms.primary?.credentials && !('encrypted' in encrypted.sms.primary.credentials)) {
      const plainCreds = encrypted.sms.primary.credentials;
      const encryptedCreds = await this.credentialEncryption.encryptObject(plainCreds);
      encrypted.sms.primary.credentials = { encrypted: encryptedCreds };
    }

    return encrypted;
  }

  /**
   * Decrypt credentials in configuration
   */
  private async decryptConfig(
    config: ClinicCommunicationConfig
  ): Promise<ClinicCommunicationConfig> {
    const decrypted = { ...config };

    // Decrypt email credentials
    if (
      decrypted.email.primary?.credentials &&
      'encrypted' in decrypted.email.primary.credentials
    ) {
      const decryptedCreds = await this.credentialEncryption.decryptObject<Record<string, string>>(
        decrypted.email.primary.credentials.encrypted
      );
      decrypted.email.primary.credentials = decryptedCreds;
    }

    // Decrypt WhatsApp credentials
    if (
      decrypted.whatsapp.primary?.credentials &&
      'encrypted' in decrypted.whatsapp.primary.credentials
    ) {
      const decryptedCreds = await this.credentialEncryption.decryptObject<Record<string, string>>(
        decrypted.whatsapp.primary.credentials.encrypted
      );
      decrypted.whatsapp.primary.credentials = decryptedCreds;
    }

    // Decrypt SMS credentials
    if (decrypted.sms.primary?.credentials && 'encrypted' in decrypted.sms.primary.credentials) {
      const decryptedCreds = await this.credentialEncryption.decryptObject<Record<string, string>>(
        decrypted.sms.primary.credentials.encrypted
      );
      decrypted.sms.primary.credentials = decryptedCreds;
    }

    return decrypted;
  }

  /**
   * Test email configuration
   * Sends a test email to verify provider configuration
   */
  async testEmailConfig(
    clinicId: string,
    testEmail: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      const config = await this.getClinicConfig(clinicId);
      if (!config || !config.email.primary) {
        return {
          success: false,
          message: 'No email configuration found for clinic',
          error: 'Configuration not found',
        };
      }

      // For testing, we'll use a simple approach
      // In production, inject ProviderFactory properly
      const adapter = await this.createTestAdapter(config.email.primary, 'email');

      if (!adapter) {
        return {
          success: false,
          message: 'Failed to create email adapter',
          error: 'Adapter creation failed',
        };
      }

      // Type guard to check if adapter has send method
      const isEmailAdapter = (
        adapter: unknown
      ): adapter is { send: (options: unknown) => Promise<EmailResult> } => {
        return (
          typeof adapter === 'object' &&
          adapter !== null &&
          'send' in adapter &&
          typeof (adapter as { send: unknown }).send === 'function'
        );
      };

      if (!isEmailAdapter(adapter)) {
        return {
          success: false,
          message: 'Invalid email adapter',
          error: 'Adapter does not implement send method',
        };
      }

      const result = await adapter.send({
        to: testEmail,
        from: config.email.defaultFrom || 'test@healthcare.com',
        subject: 'Test Email Configuration',
        body: 'This is a test email to verify your email configuration.',
        html: false,
      });

      if (result.success) {
        return {
          success: true,
          message: 'Test email sent successfully',
        };
      } else {
        const errorResponse: {
          success: false;
          message: string;
          error?: string;
        } = {
          success: false,
          message: 'Failed to send test email',
        };
        if (result.error) {
          errorResponse.error = result.error;
        }
        return errorResponse;
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to test email config: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService',
        {
          clinicId,
          testEmail,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        success: false,
        message: 'Test failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Test WhatsApp configuration
   * Sends a test message to verify provider configuration
   */
  async testWhatsAppConfig(
    clinicId: string,
    testPhone: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      const config = await this.getClinicConfig(clinicId);
      if (!config || !config.whatsapp.primary) {
        return {
          success: false,
          message: 'No WhatsApp configuration found for clinic',
          error: 'Configuration not found',
        };
      }

      // For testing, verify connection only (don't send actual message)
      const adapter = await this.createTestAdapter(config.whatsapp.primary, 'whatsapp');

      if (!adapter) {
        return {
          success: false,
          message: 'Failed to create WhatsApp adapter',
          error: 'Adapter creation failed',
        };
      }

      // Type guard to check if adapter has verify method
      const isWhatsAppAdapter = (
        adapter: unknown
      ): adapter is { verify: () => Promise<boolean> } => {
        return (
          typeof adapter === 'object' &&
          adapter !== null &&
          'verify' in adapter &&
          typeof (adapter as { verify: unknown }).verify === 'function'
        );
      };

      if (!isWhatsAppAdapter(adapter)) {
        return {
          success: false,
          message: 'Invalid WhatsApp adapter',
          error: 'Adapter does not implement verify method',
        };
      }

      const verified = await adapter.verify();

      if (verified) {
        return {
          success: true,
          message: 'WhatsApp configuration verified successfully',
        };
      } else {
        return {
          success: false,
          message: 'WhatsApp configuration verification failed',
          error: 'Connection test failed',
        };
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to test WhatsApp config: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService',
        {
          clinicId,
          testPhone,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        success: false,
        message: 'Test failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Helper to create test adapter (simplified for testing)
   */
  private async createTestAdapter(
    providerConfig: {
      provider: string;
      enabled: boolean;
      credentials: Record<string, string> | { encrypted: string };
      settings?: Record<string, unknown>;
      priority?: number;
    },
    type: 'email' | 'whatsapp'
  ): Promise<unknown> {
    // This is a simplified version for testing
    // In production, use ProviderFactory properly
    try {
      if (type === 'email') {
        const provider = providerConfig.provider;
        // Map provider names to enum values
        const providerMap: Record<string, string> = {
          smtp: 'smtp',
          aws_ses: 'aws_ses',
          ses: 'aws_ses',
          sendgrid: 'sendgrid',
        };
        const normalizedProvider = providerMap[provider.toLowerCase()] || provider;

        switch (normalizedProvider) {
          case 'smtp': {
            const { SMTPEmailAdapter } =
              await import('@communication/adapters/email/smtp-email.adapter');
            const smtpAdapter = new SMTPEmailAdapter(this.loggingService);
            smtpAdapter.initialize(providerConfig as ProviderConfig);
            return smtpAdapter;
          }
          case 'aws_ses': {
            const { SESEmailAdapter } =
              await import('@communication/adapters/email/ses-email.adapter');
            const sesAdapter = new SESEmailAdapter(this.loggingService);
            sesAdapter.initialize(providerConfig as ProviderConfig);
            return sesAdapter;
          }
          case 'sendgrid': {
            const { SendGridEmailAdapter } =
              await import('@communication/adapters/email/sendgrid-email.adapter');
            const sendgridAdapter = new SendGridEmailAdapter(this.loggingService);
            sendgridAdapter.initialize(providerConfig as ProviderConfig);
            return sendgridAdapter;
          }
        }
      } else if (type === 'whatsapp') {
        // WhatsApp adapters need HttpService - skip for now in test
        // In production, use ProviderFactory which has HttpService injected
        return null;
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create test adapter: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService',
        { error: error instanceof Error ? error.stack : undefined }
      );
    }
    return null;
  }
}
