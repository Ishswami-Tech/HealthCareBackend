import { nowIso } from '@utils/date-time.util';
/**
 * Payment Config Service
 * ======================
 * Manages per-clinic payment provider configuration
 * Handles credential encryption, caching, and fallback logic
 *
 * @module PaymentConfigService
 * @description Multi-tenant payment configuration service
 */

import { Injectable, Logger, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from './config.service';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { CredentialEncryptionService } from '@communication/config/credential-encryption.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types/logging.types';
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
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => CredentialEncryptionService))
    private readonly credentialEncryption?: CredentialEncryptionService
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
      const defaultConfig = this.getDefaultConfig(clinicId);

      // Try cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        const config = JSON.parse(cached as string) as ClinicPaymentConfig;
        // Decrypt credentials
        const decryptedCachedConfig = await this.decryptConfig(config);
        return this.mergePaymentConfigWithDefaults(decryptedCachedConfig, defaultConfig);
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

      return this.mergePaymentConfigWithDefaults(decryptedConfig, defaultConfig);
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
    const cashfreeAppId = this.configService.getEnv('CASHFREE_APP_ID') || '';
    const cashfreeSecretKey = this.configService.getEnv('CASHFREE_SECRET_KEY') || '';
    const cashfreeEnv = this.configService.getEnv('CASHFREE_ENVIRONMENT', 'sandbox');
    const cashfreeEnabled = cashfreeAppId.length > 0 && cashfreeSecretKey.length > 0;

    const razorpayKeyId = this.configService.getEnv('RAZORPAY_KEY_ID') || '';
    const razorpayKeySecret = this.configService.getEnv('RAZORPAY_KEY_SECRET') || '';
    const razorpayWebhookSecret = this.configService.getEnv('RAZORPAY_WEBHOOK_SECRET') || '';
    const razorpayEnabled = razorpayKeyId.length > 0 && razorpayKeySecret.length > 0;

    const phonepeClientId = this.configService.getEnv('PHONEPE_CLIENT_ID') || '';
    const phonepeClientSecret = this.configService.getEnv('PHONEPE_CLIENT_SECRET') || '';
    const phonepeClientVersion = '1';
    const phonepeEnv = this.configService.getEnv('PHONEPE_ENVIRONMENT', 'sandbox');
    const phonepeEnabled = phonepeClientId.length > 0 && phonepeClientSecret.length > 0;

    const easebuzzMerchantKey = this.configService.getEnv('EASEBUZZ_MERCHANT_KEY') || '';
    const easebuzzMerchantSalt = this.configService.getEnv('EASEBUZZ_MERCHANT_SALT') || '';
    const easebuzzEnv = this.configService.getEnv('EASEBUZZ_ENVIRONMENT', 'TEST');
    const easebuzzEnabled = easebuzzMerchantKey.length > 0 && easebuzzMerchantSalt.length > 0;

    const paytmMerchantId = this.configService.getEnv('PAYTM_MERCHANT_ID') || '';
    const paytmMerchantKey = this.configService.getEnv('PAYTM_MERCHANT_KEY') || '';
    const paytmWebsite = this.configService.getEnv('PAYTM_WEBSITE', 'WEBSTAGING') || 'WEBSTAGING';
    const paytmIndustryType =
      this.configService.getEnv('PAYTM_INDUSTRY_TYPE_ID', 'Retail') || 'Retail';
    const paytmEnv = this.configService.getEnv('PAYTM_ENVIRONMENT', 'staging');
    const paytmEnabled = paytmMerchantId.length > 0 && paytmMerchantKey.length > 0;

    const payuMerchantKey = this.configService.getEnv('PAYU_MERCHANT_KEY') || '';
    const payuMerchantSalt = this.configService.getEnv('PAYU_MERCHANT_SALT') || '';
    const payuClientId = this.configService.getEnv('PAYU_CLIENT_ID') || '';
    const payuClientSecret = this.configService.getEnv('PAYU_CLIENT_SECRET') || '';
    const payuEnv = this.configService.getEnv('PAYU_ENVIRONMENT', 'test');
    const payuEnabled = payuMerchantKey.length > 0 && payuMerchantSalt.length > 0;

    // Determine primary provider (priority: Cashfree > Razorpay > PhonePe > Easebuzz > Paytm > PayU)
    let primary: ClinicPaymentConfig['payment']['primary'];
    if (cashfreeEnabled) {
      primary = {
        provider: PaymentProvider.CASHFREE,
        enabled: true,
        credentials: {
          appId: cashfreeAppId,
          secretKey: cashfreeSecretKey,
          environment: cashfreeEnv || 'sandbox',
          baseUrl:
            cashfreeEnv === 'production'
              ? 'https://api.cashfree.com/pg'
              : 'https://sandbox.cashfree.com/pg',
          apiVersion: '2025-01-01',
        },
        priority: 1,
      };
    } else if (razorpayEnabled) {
      primary = {
        provider: PaymentProvider.RAZORPAY,
        enabled: true,
        credentials: {
          keyId: razorpayKeyId,
          keySecret: razorpayKeySecret,
          webhookSecret: razorpayWebhookSecret,
        },
        priority: 1,
      };
    } else if (phonepeEnabled) {
      primary = {
        provider: PaymentProvider.PHONEPE,
        enabled: true,
        credentials: {
          clientId: phonepeClientId,
          clientSecret: phonepeClientSecret,
          clientVersion: phonepeClientVersion,
          environment: phonepeEnv || 'sandbox',
        },
        priority: 1,
      };
    } else {
      primary = {
        provider: PaymentProvider.CASHFREE,
        enabled: false,
        credentials: {},
        priority: 1,
      };
    }

    // Build fallback providers
    const fallback: ClinicPaymentConfig['payment']['fallback'] = [];
    if (razorpayEnabled && primary.provider !== PaymentProvider.RAZORPAY) {
      fallback.push({
        provider: PaymentProvider.RAZORPAY,
        enabled: true,
        credentials: {
          keyId: razorpayKeyId,
          keySecret: razorpayKeySecret,
          webhookSecret: razorpayWebhookSecret,
        },
        priority: 2,
      });
    }
    if (phonepeEnabled && primary.provider !== PaymentProvider.PHONEPE) {
      fallback.push({
        provider: PaymentProvider.PHONEPE,
        enabled: true,
        credentials: {
          clientId: phonepeClientId,
          clientSecret: phonepeClientSecret,
          clientVersion: phonepeClientVersion,
          environment: phonepeEnv || 'sandbox',
        },
        priority: 3,
      });
    }
    if (easebuzzEnabled && primary.provider !== PaymentProvider.EASEBUZZ) {
      fallback.push({
        provider: PaymentProvider.EASEBUZZ,
        enabled: true,
        credentials: {
          merchantKey: easebuzzMerchantKey,
          merchantSalt: easebuzzMerchantSalt,
          environment: easebuzzEnv || 'TEST',
          baseUrl:
            easebuzzEnv === 'PRODUCTION'
              ? 'https://dashboard.easebuzz.in'
              : 'https://test.easebuzz.in',
        },
        priority: 4,
      });
    }
    if (paytmEnabled && primary.provider !== PaymentProvider.PAYTM) {
      fallback.push({
        provider: PaymentProvider.PAYTM,
        enabled: true,
        credentials: {
          merchantId: paytmMerchantId,
          merchantKey: paytmMerchantKey,
          website: paytmWebsite,
          industryTypeId: paytmIndustryType,
          environment: paytmEnv || 'staging',
          baseUrl:
            paytmEnv === 'production'
              ? 'https://securegw.paytm.in'
              : 'https://securegw-stage.paytm.in',
        },
        priority: 5,
      });
    }
    if (payuEnabled && primary.provider !== PaymentProvider.PAYU) {
      fallback.push({
        provider: PaymentProvider.PAYU,
        enabled: true,
        credentials: {
          merchantKey: payuMerchantKey,
          merchantSalt: payuMerchantSalt,
          clientId: payuClientId,
          clientSecret: payuClientSecret,
          environment: payuEnv || 'test',
          baseUrl: payuEnv === 'production' ? 'https://info.payu.in' : 'https://test.payu.in',
        },
        priority: 6,
      });
    }

    return {
      clinicId,
      payment: {
        primary,
        fallback,
        defaultCurrency: this.configService.getEnv('PAYMENT_DEFAULT_CURRENCY', 'INR') || 'INR',
        defaultProvider: primary.provider,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  private mergePaymentConfigWithDefaults(
    config: ClinicPaymentConfig,
    defaults: ClinicPaymentConfig
  ): ClinicPaymentConfig {
    const primary = config.payment.primary || defaults.payment.primary;
    const fallbackByProvider = new Map<
      PaymentProvider,
      NonNullable<ClinicPaymentConfig['payment']['fallback']>[number]
    >();

    for (const fallback of config.payment.fallback || []) {
      fallbackByProvider.set(fallback.provider, fallback);
    }

    for (const fallback of defaults.payment.fallback || []) {
      if (!fallbackByProvider.has(fallback.provider) && fallback.provider !== primary?.provider) {
        fallbackByProvider.set(fallback.provider, fallback);
      }
    }

    return {
      ...config,
      payment: {
        ...defaults.payment,
        ...config.payment,
        fallback: Array.from(fallbackByProvider.values()),
        ...(primary ? { primary } : {}),
        ...(config.payment.defaultProvider || primary?.provider || defaults.payment.defaultProvider
          ? {
              defaultProvider:
                config.payment.defaultProvider ||
                primary?.provider ||
                defaults.payment.defaultProvider,
            }
          : {}),
      },
    };
  }

  /**
   * Fetch configuration from database
   * Reads from Clinic.settings.paymentSettings (JSONB field)
   */
  private async fetchFromDatabase(clinicId: string): Promise<ClinicPaymentConfig | null> {
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

      // Prepare payment settings (exclude clinicId, createdAt, updatedAt from JSON)
      const { clinicId: _clinicId, ...paymentSettings } = config;
      const updatedSettings = {
        ...currentSettings,
        paymentSettings: {
          ...paymentSettings,
          updatedAt: nowIso(),
          createdAt: paymentSettings.createdAt
            ? new Date(paymentSettings.createdAt).toISOString()
            : nowIso(),
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
    if (!this.credentialEncryption) {
      throw new Error(
        'CredentialEncryptionService is not available. CommunicationConfigModule must be imported.'
      );
    }

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
    if (!this.credentialEncryption) {
      // If encryption service is not available, return config as-is (credentials may already be decrypted)
      // This allows the service to work even if CommunicationConfigModule is not imported
      return config;
    }

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
