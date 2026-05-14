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
    ENV_VARS.API_URL,
    ENV_VARS.BASE_URL,
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
    ENV_VARS.API_URL,
    ENV_VARS.BASE_URL,
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
    ENV_VARS.API_URL,
    ENV_VARS.BASE_URL,
    ENV_VARS.FRONTEND_URL,
    'SESSION_SECRET',
    'COOKIE_SECRET',
    'COMMUNICATION_ENCRYPTION_KEY',
    ENV_VARS.CORS_ORIGIN,
  ], // Same as staging
  development: [], // Development is lenient
  test: [], // Test is lenient
} as const;

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
  warnings: readonly string[];
} {
  const requiredVars = REQUIRED_VARS_BY_ENV[environment] || [];
  const recommendedVars = RECOMMENDED_VARS_BY_ENV[environment] || [];

  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  // Use helper function (which uses dotenv) for environment variable access
  for (const varName of requiredVars) {
    if (!getEnv(varName)) {
      missing.push(varName);
    }
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

  // Throw error if required variables are missing
  if (missing.length > 0 && throwOnMissing) {
    const envFile = `.env.${environment}`;
    const localFile = '.env.local';
    throw new Error(
      `Missing required environment variables for ${environment}: ${missing.join(', ')}\n` +
        `Please set these variables in ${envFile} or ${localFile}\n` +
        `Example:\n` +
        missing.map(v => `  ${v}=your-value-here`).join('\n')
    );
  }

  return {
    isValid: missing.length === 0,
    missing,
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
  missingVars: readonly string[]
): string {
  const envFile = `.env.${environment}`;
  const localFile = '.env.local';

  let message = `\n❌ Missing required environment variables for ${environment}:\n\n`;

  for (const varName of missingVars) {
    message += `  • ${varName}\n`;
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
  };

  return examples[varName] || 'your-value-here';
}
