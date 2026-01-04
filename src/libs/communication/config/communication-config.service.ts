/**
 * Communication Config Service
 * =============================
 * Manages per-clinic communication provider configuration
 * Handles credential encryption, caching, and fallback logic
 *
 * @module CommunicationConfigService
 * @description Multi-tenant communication configuration service
 */

import { Injectable, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database/database.service';
// Use direct import to avoid TDZ issues with barrel exports
import { CacheService } from '@infrastructure/cache/cache.service';
import { CredentialEncryptionService } from './credential-encryption.service';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
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
  MAILGUN = 'mailgun',
  MAILTRAP = 'mailtrap', // Dev/Staging only
  ZEPTOMAIL = 'zeptomail',
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
  private readonly cacheTTL = 3600; // 1 hour

  private suppressionListService: SuppressionListService | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly credentialEncryption: CredentialEncryptionService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => SuppressionListService))
    suppressionListService: SuppressionListService | undefined
  ) {
    this.suppressionListService = suppressionListService;
  }

  /**
   * Lazy getter for SuppressionListService to avoid circular dependency issues
   */
  private getSuppressionListService(): SuppressionListService {
    if (!this.suppressionListService) {
      throw new Error(
        'SuppressionListService is not available. Ensure EmailServicesModule is imported.'
      );
    }
    return this.suppressionListService;
  }

  async onModuleInit(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'CommunicationConfigService initialized',
      'CommunicationConfigService',
      {}
    );
  }

  /**
   * Get clinic communication configuration
   * Priority: Database config > Clinic-specific env vars > Global env vars
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
        // Return default config with clinic-specific env vars if none exists
        return await this.getDefaultConfig(clinicId);
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
      return await this.getDefaultConfig(clinicId);
    }
  }

  /**
   * Save clinic communication configuration
   * @param config - Communication configuration to save
   * @param userId - Optional user ID for audit trail (defaults to 'system')
   */
  async saveClinicConfig(
    config: ClinicCommunicationConfig,
    userId: string = 'system'
  ): Promise<void> {
    const cacheKey = `communication:config:${config.clinicId}`;

    try {
      // Encrypt credentials before saving
      const encryptedConfig = await this.encryptConfig(config);

      // Save to database
      await this.saveToDatabase(encryptedConfig, userId);

      // Invalidate cache
      await this.cacheService.delete(cacheKey);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Saved clinic communication config: ${config.clinicId}`,
        'CommunicationConfigService',
        {
          clinicId: config.clinicId,
          userId, // Include userId in log context
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
          userId, // Include userId in log context
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get clinic information (name, app_name, subdomain) for env var lookup
   */
  private async getClinicInfo(clinicId: string): Promise<{
    name: string;
    appName: string;
    subdomain: string | null;
  } | null> {
    try {
      const clinic = await this.databaseService.executeHealthcareRead(async client => {
        const clinicClient = client as unknown as {
          clinic: {
            findUnique: (args: {
              where: { id: string };
              select: { name: true; app_name: true; subdomain: true };
            }) => Promise<{ name: string; app_name: string; subdomain: string } | null>;
          };
        };
        return await clinicClient.clinic.findUnique({
          where: { id: clinicId },
          select: {
            name: true,
            app_name: true,
            subdomain: true,
          },
        });
      });

      if (!clinic) {
        return null;
      }

      return {
        name: clinic.name,
        appName: clinic.app_name,
        subdomain: clinic.subdomain,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to fetch clinic info for env var lookup: ${error instanceof Error ? error.message : String(error)}`,
        'CommunicationConfigService.getClinicInfo',
        { clinicId }
      );
      return null;
    }
  }

  /**
   * Sanitize clinic identifier for environment variable key
   * Converts to uppercase and replaces spaces/special chars with underscores
   */
  private sanitizeForEnvVar(identifier: string): string {
    return identifier
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Get environment variable with clinic-specific fallback
   * Priority: Clinic-specific (by name) > Clinic-specific (by app_name) > Clinic-specific (by subdomain) > Global
   */
  private getEnvVarWithClinicFallback(
    baseKey: string,
    clinicInfo: { name: string; appName: string; subdomain: string | null } | null
  ): string {
    // Try clinic-specific env vars first
    if (clinicInfo) {
      // Try by sanitized clinic name
      const nameKey = `CLINIC_${this.sanitizeForEnvVar(clinicInfo.name)}_${baseKey}`;
      const nameValue = process.env[nameKey];
      if (nameValue) {
        return nameValue;
      }

      // Try by app_name
      const appNameKey = `CLINIC_${this.sanitizeForEnvVar(clinicInfo.appName)}_${baseKey}`;
      const appNameValue = process.env[appNameKey];
      if (appNameValue) {
        return appNameValue;
      }

      // Try by subdomain if available
      if (clinicInfo.subdomain) {
        const subdomainKey = `CLINIC_${this.sanitizeForEnvVar(clinicInfo.subdomain)}_${baseKey}`;
        const subdomainValue = process.env[subdomainKey];
        if (subdomainValue) {
          return subdomainValue;
        }
      }
    }

    // Fallback to global env var
    return process.env[baseKey] || '';
  }

  /**
   * Get default configuration (fallback)
   * Loads from clinic-specific environment variables first, then global env vars
   * Supports patterns like:
   * - CLINIC_AADESH_AYURVEDELAY_ZEPTOMAIL_SEND_MAIL_TOKEN
   * - CLINIC_AADESH_AYURVEDALAY_ZEPTOMAIL_SEND_MAIL_TOKEN (by app_name)
   * - CLINIC_AADESH_ZEPTOMAIL_SEND_MAIL_TOKEN (by subdomain)
   * - ZEPTOMAIL_SEND_MAIL_TOKEN (global fallback)
   */
  private async getDefaultConfig(clinicId: string): Promise<ClinicCommunicationConfig> {
    // Get clinic info for clinic-specific env var lookup
    const clinicInfo = await this.getClinicInfo(clinicId);

    // Load ZeptoMail credentials with clinic-specific fallback
    const zeptoMailToken = this.getEnvVarWithClinicFallback(
      'ZEPTOMAIL_SEND_MAIL_TOKEN',
      clinicInfo
    );
    const zeptoMailFromEmail = this.getEnvVarWithClinicFallback('ZEPTOMAIL_FROM_EMAIL', clinicInfo);
    const zeptoMailFromName = this.getEnvVarWithClinicFallback('ZEPTOMAIL_FROM_NAME', clinicInfo);
    const zeptoMailBounceAddress = this.getEnvVarWithClinicFallback(
      'ZEPTOMAIL_BOUNCE_ADDRESS',
      clinicInfo
    );

    // Load WhatsApp credentials with clinic-specific fallback
    const whatsappApiKey = this.getEnvVarWithClinicFallback('WHATSAPP_API_KEY', clinicInfo);
    const whatsappPhoneNumberId = this.getEnvVarWithClinicFallback(
      'WHATSAPP_PHONE_NUMBER_ID',
      clinicInfo
    );
    const whatsappBusinessAccountId = this.getEnvVarWithClinicFallback(
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
      clinicInfo
    );

    // Load SMS credentials with clinic-specific fallback
    const smsApiKey = this.getEnvVarWithClinicFallback('SMS_API_KEY', clinicInfo);
    const smsApiSecret = this.getEnvVarWithClinicFallback('SMS_API_SECRET', clinicInfo);
    const smsFromNumber = this.getEnvVarWithClinicFallback('SMS_FROM_NUMBER', clinicInfo);

    // Load AWS SES credentials with clinic-specific fallback
    const awsSesFromEmail = this.getEnvVarWithClinicFallback('AWS_SES_FROM_EMAIL', clinicInfo);
    const awsSesFromName = this.getEnvVarWithClinicFallback('AWS_SES_FROM_NAME', clinicInfo);
    const awsAccessKeyId = this.getEnvVarWithClinicFallback('AWS_ACCESS_KEY_ID', clinicInfo);
    const awsSecretAccessKey = this.getEnvVarWithClinicFallback(
      'AWS_SECRET_ACCESS_KEY',
      clinicInfo
    );
    const awsRegion = this.getEnvVarWithClinicFallback('AWS_REGION', clinicInfo);

    // Clean token if it includes "Zoho-enczapikey" prefix
    const cleanToken = zeptoMailToken.replace(/^Zoho-enczapikey\s+/i, '').trim();

    // Determine email provider based on available credentials
    let emailProvider = EmailProvider.ZEPTOMAIL;
    let emailCredentials: Record<string, string> = {};

    if (cleanToken && zeptoMailFromEmail) {
      // ZeptoMail is available
      emailProvider = EmailProvider.ZEPTOMAIL;
      emailCredentials = {
        sendMailToken: cleanToken,
        fromEmail: zeptoMailFromEmail,
        fromName:
          zeptoMailFromName ||
          this.configService.getEnv('APP_NAME') ||
          this.configService.getEnv('DEFAULT_FROM_NAME') ||
          'Healthcare App',
        bounceAddress: zeptoMailBounceAddress,
      };
    } else if (awsAccessKeyId && awsSecretAccessKey && awsSesFromEmail) {
      // AWS SES is available
      emailProvider = EmailProvider.AWS_SES;
      emailCredentials = {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
        region: awsRegion || 'us-east-1',
        fromEmail: awsSesFromEmail,
        fromName:
          awsSesFromName ||
          this.configService.getEnv('APP_NAME') ||
          this.configService.getEnv('DEFAULT_FROM_NAME') ||
          'Healthcare App',
      };
    }

    // Determine WhatsApp provider
    let whatsappProvider = WhatsAppProvider.META_BUSINESS;
    let whatsappCredentials: Record<string, string> = {};

    if (whatsappApiKey && whatsappPhoneNumberId) {
      whatsappProvider = WhatsAppProvider.META_BUSINESS;
      whatsappCredentials = {
        apiKey: whatsappApiKey,
        phoneNumberId: whatsappPhoneNumberId,
        businessAccountId: whatsappBusinessAccountId,
      };
    }

    // Determine SMS provider
    let smsProvider = SMSProvider.AWS_SNS;
    let smsCredentials: Record<string, string> = {};

    if (smsApiKey && smsApiSecret) {
      smsProvider = SMSProvider.TWILIO; // Assuming Twilio if API key/secret provided
      smsCredentials = {
        apiKey: smsApiKey,
        apiSecret: smsApiSecret,
        fromNumber: smsFromNumber,
      };
    } else if (awsAccessKeyId && awsSecretAccessKey) {
      smsProvider = SMSProvider.AWS_SNS;
      smsCredentials = {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
        region: awsRegion || 'us-east-1',
      };
    }

    return {
      clinicId,
      email: {
        primary: {
          provider: emailProvider,
          enabled: Object.keys(emailCredentials).length > 0,
          credentials: emailCredentials,
          priority: 1,
        },
      },
      whatsapp: {
        primary: {
          provider: whatsappProvider,
          enabled: Object.keys(whatsappCredentials).length > 0,
          credentials: whatsappCredentials,
          priority: 1,
        },
      },
      sms: {
        primary: {
          provider: smsProvider,
          enabled: Object.keys(smsCredentials).length > 0,
          credentials: smsCredentials,
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
        const clinicClient = client as unknown as {
          clinic: {
            findUnique: (args: {
              where: { id: string };
              select: { settings: true };
            }) => Promise<{ settings: unknown } | null>;
          };
        };
        return await clinicClient.clinic.findUnique({
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
   * @param config - Communication configuration to save
   * @param userId - Optional user ID for audit trail (defaults to 'system')
   */
  private async saveToDatabase(
    config: ClinicCommunicationConfig,
    userId: string = 'system'
  ): Promise<void> {
    try {
      // Get current clinic settings to preserve other settings
      const currentClinic = await this.databaseService.executeHealthcareRead(async client => {
        const clinicClient = client as unknown as {
          clinic: {
            findUnique: (args: {
              where: { id: string };
              select: { settings: true };
            }) => Promise<{ settings: unknown } | null>;
          };
        };
        return await clinicClient.clinic.findUnique({
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
          const clinicClient = client as unknown as {
            clinic: {
              update: (args: {
                where: { id: string };
                data: { settings: unknown };
              }) => Promise<unknown>;
            };
          };
          return await clinicClient.clinic.update({
            where: { id: config.clinicId },
            data: {
              settings: updatedSettings as never, // Prisma Json type
            },
          });
        },
        {
          userId,
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
   * Test SMS configuration
   * Validates SMS provider configuration
   */
  async testSMSConfig(
    clinicId: string,
    testPhone: string
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      const config = await this.getClinicConfig(clinicId);
      if (!config || !config.sms.primary) {
        return {
          success: false,
          message: 'No SMS configuration found for clinic',
          error: 'Configuration not found',
        };
      }

      // Validate credentials format
      const credentials = config.sms.primary.credentials;
      if (!credentials || typeof credentials !== 'object') {
        return {
          success: false,
          message: 'Invalid SMS credentials',
          error: 'Credentials missing or invalid',
        };
      }

      // Check if credentials are encrypted (should be decrypted by getClinicConfig)
      if ('encrypted' in credentials) {
        return {
          success: false,
          message: 'SMS credentials are encrypted',
          error: 'Credentials need to be decrypted first',
        };
      }

      const provider = config.sms.primary.provider;
      const providerString = String(provider).toLowerCase();

      // Access credentials safely (already checked for encrypted above)
      const getCredential = (key: string): string | undefined => {
        if ('encrypted' in credentials) {
          return undefined;
        }
        const creds = credentials;
        return (
          creds[key] ||
          creds[key.toLowerCase()] ||
          creds[key.replace(/([A-Z])/g, '_$1').toLowerCase()]
        );
      };

      // Validate provider-specific credentials
      if (providerString === 'twilio') {
        const apiKey = getCredential('apiKey') || getCredential('api_key');
        const apiSecret = getCredential('apiSecret') || getCredential('api_secret');
        if (!apiKey || !apiSecret) {
          return {
            success: false,
            message: 'Twilio credentials incomplete',
            error: 'Missing apiKey or apiSecret',
          };
        }
      } else if (providerString === 'aws_sns') {
        const accessKeyId = getCredential('accessKeyId') || getCredential('access_key_id');
        const secretAccessKey =
          getCredential('secretAccessKey') || getCredential('secret_access_key');
        if (!accessKeyId || !secretAccessKey) {
          return {
            success: false,
            message: 'AWS SNS credentials incomplete',
            error: 'Missing accessKeyId or secretAccessKey',
          };
        }
      }

      // Basic validation passed
      return {
        success: true,
        message:
          'SMS configuration validated successfully (Note: SMS service implementation pending)',
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to test SMS config: ${error instanceof Error ? error.message : String(error)}`,
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
          zeptomail: 'zeptomail',
          zoho: 'zeptomail',
        };
        const normalizedProvider = providerMap[provider.toLowerCase()] || provider;

        switch (normalizedProvider) {
          case 'smtp': {
            const { SMTPEmailAdapter } =
              await import('@communication/adapters/email/smtp-email.adapter');
            const smtpAdapter = new SMTPEmailAdapter(
              this.loggingService,
              this.getSuppressionListService()
            );
            smtpAdapter.initialize(providerConfig as ProviderConfig);
            return smtpAdapter;
          }
          case 'aws_ses': {
            const { SESEmailAdapter } =
              await import('@communication/adapters/email/ses/ses-email.adapter');
            const sesAdapter = new SESEmailAdapter(
              this.loggingService,
              this.getSuppressionListService()
            );
            sesAdapter.initialize(providerConfig as ProviderConfig);
            return sesAdapter;
          }
          case 'zeptomail': {
            // ZeptoMail adapter requires HttpService which needs NestHttpService
            // For testing, return null - use ProviderFactory in production
            // This is a limitation of the test adapter method
            await this.loggingService.log(
              LogType.EMAIL,
              LogLevel.WARN,
              'ZeptoMail adapter requires HttpService - use ProviderFactory for testing',
              'CommunicationConfigService',
              { provider: 'zeptomail' }
            );
            return null;
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
