#!/usr/bin/env node

/**
 * Environment Variable Validation Script
 * Validates required environment variables before build
 */

const NODE_ENV = process.env['NODE_ENV'] || 'development';

// Required environment variables for production
const PRODUCTION_REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

// Required environment variables for staging
const STAGING_REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];

// Required environment variables for all environments (optional, can have defaults)
const RECOMMENDED = ['DATABASE_URL', 'JWT_SECRET', 'REDIS_HOST'];

function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Determine required variables based on environment
  let requiredVars: string[] = [];
  if (NODE_ENV === 'production') {
    requiredVars = PRODUCTION_REQUIRED;
  } else if (NODE_ENV === 'staging') {
    requiredVars = STAGING_REQUIRED;
  } else {
    // Development - only warn about missing recommended vars
    requiredVars = [];
  }

  // Check required variables
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check recommended variables (warnings only)
  for (const varName of RECOMMENDED) {
    if (!process.env[varName] && !requiredVars.includes(varName)) {
      warnings.push(varName);
    }
  }

  // Report results
  if (missing.length > 0) {
    console.error(`\n❌ Missing required environment variables for ${NODE_ENV}:`);
    missing.forEach(varName => {
      console.error(`  - ${varName}`);
    });
    console.error('\nPlease set these variables before building.\n');
    process.exit(1);
  }

  if (warnings.length > 0 && NODE_ENV === 'development') {
    console.warn(`\n⚠️  Recommended environment variables not set (using defaults):`);
    warnings.forEach(varName => {
      console.warn(`  - ${varName}`);
    });
    console.warn('');
  }

  if (missing.length === 0) {
    console.log(`✓ Environment validation passed for ${NODE_ENV}`);
    if (NODE_ENV === 'production') {
      console.log('✓ All required production variables are set');
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
