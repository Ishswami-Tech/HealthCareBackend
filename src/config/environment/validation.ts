import { ENV_VARS } from '@config/constants';
import { getEnv } from './utils';

/**
 * Environment-specific required variables
 * Maps each environment to its required environment variables
 */
const REQUIRED_VARS_BY_ENV: Record<string, readonly string[]> = {
  production: [
    ENV_VARS.DATABASE_URL,
    ENV_VARS.JWT_SECRET,
    ENV_VARS.HOST,
    ENV_VARS.FRONTEND_URL,
    'SESSION_SECRET',
    'COOKIE_SECRET',
    'COMMUNICATION_ENCRYPTION_KEY',
    ENV_VARS.CORS_ORIGIN,
  ],
  staging: [
    ENV_VARS.DATABASE_URL,
    ENV_VARS.JWT_SECRET,
    ENV_VARS.HOST,
    ENV_VARS.FRONTEND_URL,
    'SESSION_SECRET',
    'COOKIE_SECRET',
    'COMMUNICATION_ENCRYPTION_KEY',
    ENV_VARS.CORS_ORIGIN,
  ],
  'local-prod': [
    ENV_VARS.DATABASE_URL,
    ENV_VARS.JWT_SECRET,
    ENV_VARS.HOST,
    ENV_VARS.FRONTEND_URL,
    'SESSION_SECRET',
    'COOKIE_SECRET',
    'COMMUNICATION_ENCRYPTION_KEY',
    ENV_VARS.CORS_ORIGIN,
  ], // Same as staging
  development: [], // Development is lenient
  test: [], // Test is lenient
} as const;

/** Minimum length for signing secrets (HMAC keys). */
const MIN_SECRET_LENGTH = 32;
const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Secrets that have an insecure development fallback in code. In production a missing or
 * malformed value must stop the boot instead of silently using the fallback:
 *  - QR_SECRET_KEY (or legacy QR_ENCRYPTION_KEY): otherwise check-in posters are signed with
 *    'fallback_dev_secret' and anyone can forge them.
 *  - PHI_CACHE_ENCRYPTION_KEY: otherwise PHI is cached in plaintext.
 *  - JWT_SECRET: must be a real key, not a short placeholder.
 *  - Cashfree credentials whenever Cashfree is enabled/partially configured.
 * Only variable NAMES and rules are ever reported, never values.
 */
interface SecretIssues {
  readonly missing: string[];
  readonly invalid: string[];
}

function isTruthyEnv(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function collectSecretIssues(): SecretIssues {
  const missing: string[] = [];
  const invalid: string[] = [];

  const qrKey = getEnv('QR_SECRET_KEY') || getEnv('QR_ENCRYPTION_KEY');
  if (!qrKey) {
    missing.push('QR_SECRET_KEY');
  } else if (qrKey.length < MIN_SECRET_LENGTH) {
    invalid.push(`QR_SECRET_KEY (must be at least ${MIN_SECRET_LENGTH} characters)`);
  }

  const phiKey = getEnv('PHI_CACHE_ENCRYPTION_KEY');
  if (!phiKey) {
    missing.push('PHI_CACHE_ENCRYPTION_KEY');
  } else if (!HEX_64.test(phiKey.trim())) {
    invalid.push('PHI_CACHE_ENCRYPTION_KEY (must be exactly 64 hex characters = 32 bytes)');
  }

  const jwtSecret = getEnv(ENV_VARS.JWT_SECRET);
  if (jwtSecret && jwtSecret.length < MIN_SECRET_LENGTH) {
    invalid.push(`${ENV_VARS.JWT_SECRET} (must be at least ${MIN_SECRET_LENGTH} characters)`);
  }
  const refreshSecret = getEnv(ENV_VARS.JWT_REFRESH_SECRET);
  if (refreshSecret && refreshSecret.length < MIN_SECRET_LENGTH) {
    invalid.push(
      `${ENV_VARS.JWT_REFRESH_SECRET} (must be at least ${MIN_SECRET_LENGTH} characters)`
    );
  }

  const cashfreeAppId = getEnv('CASHFREE_APP_ID');
  const cashfreeSecret = getEnv('CASHFREE_SECRET_KEY');
  const defaultProvider = (
    getEnv('PAYMENT_PROVIDER') ||
    getEnv('DEFAULT_PAYMENT_PROVIDER') ||
    ''
  ).toLowerCase();
  const cashfreeEnabled =
    isTruthyEnv(getEnv('CASHFREE_ENABLED')) ||
    defaultProvider === 'cashfree' ||
    Boolean(cashfreeAppId) ||
    Boolean(cashfreeSecret);
  if (cashfreeEnabled) {
    if (!cashfreeAppId) missing.push('CASHFREE_APP_ID');
    if (!cashfreeSecret) missing.push('CASHFREE_SECRET_KEY');
  }

  return { missing, invalid };
}

/**
 * Environment-specific recommended variables
 * These are not required but should be set for proper functionality
 */
const RECOMMENDED_VARS_BY_ENV: Record<string, readonly string[]> = {
  production: [ENV_VARS.REDIS_HOST, ENV_VARS.EMAIL_HOST],
  staging: [ENV_VARS.REDIS_HOST, ENV_VARS.EMAIL_HOST],
  'local-prod': [ENV_VARS.REDIS_HOST, ENV_VARS.EMAIL_HOST], // Same as staging
  development: [ENV_VARS.DATABASE_URL, ENV_VARS.REDIS_HOST],
  test: [ENV_VARS.DATABASE_URL],
} as const;

/**
 * Validates environment variables for a specific environment
 *
 * @param environment - The environment to validate (development, production, staging, test, local-prod)
 * @param throwOnMissing - Whether to throw an error if required variables are missing (default: true)
 * @returns Object containing validation results
 *
 * @example
 * ```typescript
 * const result = validateEnvironmentConfig('production');
 * if (!result.isValid) {
 *   console.error('Missing variables:', result.missing);
 * }
 * ```
 */
export function validateEnvironmentConfig(
  environment: string,
  throwOnMissing = true
): {
  isValid: boolean;
  missing: readonly string[];
  invalid: readonly string[];
  warnings: readonly string[];
} {
  const requiredVars = REQUIRED_VARS_BY_ENV[environment] || [];
  const recommendedVars = RECOMMENDED_VARS_BY_ENV[environment] || [];

  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  // Use helper function (which uses dotenv) for environment variable access
  for (const varName of requiredVars) {
    if (!getEnv(varName)) {
      missing.push(varName);
    }
  }

  // Secrets with insecure code fallbacks: fatal in production, warnings everywhere else so
  // local development keeps working without them.
  const secretIssues = collectSecretIssues();
  if (environment === 'production') {
    for (const varName of secretIssues.missing) {
      if (!missing.includes(varName)) {
        missing.push(varName);
      }
    }
    invalid.push(...secretIssues.invalid);
  } else if (environment !== 'test') {
    warnings.push(...secretIssues.missing, ...secretIssues.invalid);
  }

  // Check recommended variables (warnings only)
  // Use helper function (which uses dotenv) for environment variable access
  for (const varName of recommendedVars) {
    if (!getEnv(varName) && !requiredVars.includes(varName)) {
      warnings.push(varName);
    }
  }

  const addConditionalWarnings = (enabled: boolean, vars: readonly string[]): void => {
    if (!enabled) {
      return;
    }

    for (const varName of vars) {
      if (!getEnv(varName) && !requiredVars.includes(varName) && !warnings.includes(varName)) {
        warnings.push(varName);
      }
    }
  };

  const whatsappEnabled = getEnv(ENV_VARS.WHATSAPP_ENABLED) === 'true';
  addConditionalWarnings(whatsappEnabled, [
    ENV_VARS.WHATSAPP_API_KEY,
    ENV_VARS.WHATSAPP_PHONE_NUMBER_ID,
    ENV_VARS.WHATSAPP_BUSINESS_ACCOUNT_ID,
    ENV_VARS.WHATSAPP_OTP_TEMPLATE_ID,
    ENV_VARS.WHATSAPP_APPOINTMENT_CONFIRMATION_TEMPLATE_ID,
    ENV_VARS.WHATSAPP_APPOINTMENT_REMINDER_TEMPLATE_ID,
    ENV_VARS.WHATSAPP_PRESCRIPTION_TEMPLATE_ID,
    'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    ENV_VARS.META_WHATSAPP_APP_ID,
    'META_WHATSAPP_APP_SECRET',
  ]);

  const emailProvider = (getEnv(ENV_VARS.EMAIL_PROVIDER) || '').toLowerCase();
  const zeptoMailEnabled = getEnv('ZEPTOMAIL_ENABLED') === 'true' || emailProvider === 'zeptomail';
  addConditionalWarnings(zeptoMailEnabled, [
    'ZEPTOMAIL_SEND_MAIL_TOKEN',
    'ZEPTOMAIL_FROM_EMAIL',
    'ZEPTOMAIL_FROM_NAME',
    'ZEPTOMAIL_BOUNCE_ADDRESS',
    'ZEPTOMAIL_API_BASE_URL',
    'ZEPTOMAIL_WEBHOOK_SECRET',
  ]);

  // Throw error if required variables are missing or malformed
  if ((missing.length > 0 || invalid.length > 0) && throwOnMissing) {
    throw new Error(getEnvironmentValidationErrorMessage(environment, missing, invalid));
  }

  return {
    isValid: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    warnings,
  };
}

/**
 * Validates all environment configurations
 * Useful for pre-deployment validation
 *
 * @param environments - Array of environments to validate (default: all)
 * @returns Map of environment to validation results
 */
export function validateAllEnvironments(
  environments: readonly string[] = ['development', 'production', 'staging', 'test', 'local-prod']
): Map<string, ReturnType<typeof validateEnvironmentConfig>> {
  const results = new Map<string, ReturnType<typeof validateEnvironmentConfig>>();

  for (const env of environments) {
    // Don't throw on missing for validation of all environments
    results.set(env, validateEnvironmentConfig(env, false));
  }

  return results;
}

/**
 * Gets helpful error message for missing environment variables
 *
 * @param environment - The environment
 * @param missingVars - Array of missing variable names
 * @returns Formatted error message with helpful suggestions
 */
export function getEnvironmentValidationErrorMessage(
  environment: string,
  missingVars: readonly string[],
  invalidVars: readonly string[] = []
): string {
  const envFile = `.env.${environment}`;
  const localFile = '.env.local';

  let message = `\n❌ Invalid environment configuration for ${environment} (values are never printed):\n\n`;

  for (const varName of missingVars) {
    message += `  • missing: ${varName}\n`;
  }
  for (const description of invalidVars) {
    message += `  • invalid: ${description}\n`;
  }

  message += `\n💡 Solution:\n`;
  message += `  1. Create or edit ${envFile} file\n`;
  message += `  2. Add the missing variables:\n\n`;

  for (const varName of missingVars) {
    const example = getExampleValue(varName);
    message += `     ${varName}=${example}\n`;
  }

  message += `\n  3. Or add them to ${localFile} for local overrides\n`;
  message += `\n📖 See .env.example for all available variables\n`;

  return message;
}

/**
 * Gets example value for an environment variable
 * Used in error messages to help users
 *
 * @param varName - Environment variable name
 * @returns Example value string
 */
function getExampleValue(varName: string): string {
  const examples: Record<string, string> = {
    [ENV_VARS.DATABASE_URL]: 'postgresql://user:password@localhost:5432/dbname',
    [ENV_VARS.JWT_SECRET]: 'your-super-secret-key-min-32-chars',
    [ENV_VARS.REDIS_HOST]: 'localhost',
    [ENV_VARS.EMAIL_HOST]: 'smtp.example.com',
    [ENV_VARS.CORS_ORIGIN]: 'http://localhost:3000',
    SESSION_SECRET: 'your-session-secret-min-32-chars',
    COOKIE_SECRET: 'your-cookie-secret-min-32-chars',
    QR_SECRET_KEY: '<openssl rand -hex 32>',
    PHI_CACHE_ENCRYPTION_KEY: '<openssl rand -hex 32  (64 hex chars)>',
    CASHFREE_APP_ID: '<from the Cashfree dashboard>',
    CASHFREE_SECRET_KEY: '<from the Cashfree dashboard>',
  };

  return examples[varName] || 'your-value-here';
}
