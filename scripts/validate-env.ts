#!/usr/bin/env node

/**
 * Environment Variable Validation Script
 * Validates required environment variables before build
 */

import 'dotenv/config';

const NODE_ENV = process.env['NODE_ENV'] || 'development';

// Required environment variables for production
const PRODUCTION_REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'COOKIE_SECRET',
  'COMMUNICATION_ENCRYPTION_KEY',
  'CORS_ORIGIN',
];

// Required environment variables for staging
const STAGING_REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'COOKIE_SECRET',
  'COMMUNICATION_ENCRYPTION_KEY',
  'CORS_ORIGIN',
];

// Required environment variables for all environments (optional, can have defaults)
const RECOMMENDED = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_HOST'];

const VIDEO_PROVIDERS = ['cloudflare', 'daily', 'google-meet'] as const;

function isTruthy(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function isMissing(value: string | undefined): boolean {
  return !value || !value.trim();
}

function pushMissingIfUnset(target: string[], varName: string): void {
  if (isMissing(process.env[varName])) {
    target.push(varName);
  }
}

function validateVideoEnvironment(missing: string[], warnings: string[]): void {
  if (!isTruthy(process.env['VIDEO_ENABLED'])) {
    return;
  }

  const provider = (process.env['VIDEO_PROVIDER'] || 'cloudflare').trim().toLowerCase();
  if (!VIDEO_PROVIDERS.includes(provider as (typeof VIDEO_PROVIDERS)[number])) {
    warnings.push(`VIDEO_PROVIDER (${provider || 'unset'})`);
    return;
  }

  if (provider === 'cloudflare') {
    pushMissingIfUnset(missing, 'CLOUDFLARE_ACCOUNT_ID');
    pushMissingIfUnset(missing, 'CLOUDFLARE_APP_ID');
    pushMissingIfUnset(missing, 'CLOUDFLARE_API_TOKEN');
  } else if (provider === 'daily') {
    pushMissingIfUnset(missing, 'DAILY_API_KEY');
    pushMissingIfUnset(missing, 'DAILY_DOMAIN');
  } else if (provider === 'google-meet') {
    pushMissingIfUnset(missing, 'GOOGLE_CLIENT_ID');
    pushMissingIfUnset(missing, 'GOOGLE_CLIENT_SECRET');
    pushMissingIfUnset(missing, 'GOOGLE_MEET_REFRESH_TOKEN');
    pushMissingIfUnset(missing, 'GOOGLE_REDIRECT_URI');
  }

  // Google Meet is currently configured as a fallback in both production-like envs.
  // If it is enabled but the refresh token is missing, surface it as a warning so the
  // deployment does not silently lose the fallback provider.
  if (isTruthy(process.env['GOOGLE_MEET_ENABLED'])) {
    if (isMissing(process.env['GOOGLE_MEET_REFRESH_TOKEN'])) {
      warnings.push('GOOGLE_MEET_REFRESH_TOKEN');
    }
    if (isMissing(process.env['GOOGLE_CLIENT_ID'])) {
      warnings.push('GOOGLE_CLIENT_ID');
    }
    if (isMissing(process.env['GOOGLE_CLIENT_SECRET'])) {
      warnings.push('GOOGLE_CLIENT_SECRET');
    }
  }
}

function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Determine required variables based on environment
  const requiredVars =
    NODE_ENV === 'production'
      ? PRODUCTION_REQUIRED
      : NODE_ENV === 'staging' || NODE_ENV === 'local-prod'
        ? STAGING_REQUIRED
        : [];

  // Check required variables
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  const isProdLike =
    NODE_ENV === 'production' || NODE_ENV === 'staging' || NODE_ENV === 'local-prod';
  const bullBoardEnabled = isProdLike && isTruthy(process.env['ENABLE_BULL_BOARD']);

  if (bullBoardEnabled) {
    for (const varName of ['QUEUE_DASHBOARD_USER', 'QUEUE_DASHBOARD_PASSWORD']) {
      if (!process.env[varName]) {
        missing.push(varName);
      }
    }
  }

  // Check recommended variables (warnings only)
  for (const varName of RECOMMENDED) {
    if (!process.env[varName] && !requiredVars.includes(varName)) {
      warnings.push(varName);
    }
  }

  validateVideoEnvironment(missing, warnings);

  // Report results
  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables for ${NODE_ENV}:`);
    [...new Set(missing)].forEach(varName => {
      console.error(`  - ${varName}`);
    });
    console.error('\nPlease set these variables before building.\n');
    process.exit(1);
  }

  if (warnings.length > 0 && NODE_ENV === 'development') {
    console.warn(`\n[WARN] Recommended environment variables not set (using defaults):`);
    warnings.forEach(varName => {
      console.warn(`  - ${varName}`);
    });
    console.warn('');
  }

  if (missing.length === 0) {
    console.log(`[OK] Environment validation passed for ${NODE_ENV}`);
    if (NODE_ENV === 'production') {
      console.log('[OK] All required production variables are set');
    }
    if (bullBoardEnabled) {
      console.log('[OK] Bull Board is enabled and dashboard credentials are set');
    }
  }
}

// Run validation
try {
  validateEnvironment();
} catch (error) {
  console.error(
    'Environment validation failed:',
    error instanceof Error ? error.message : String(error),
    { stack: error instanceof Error ? error.stack : undefined }
  );
  process.exit(1);
}
