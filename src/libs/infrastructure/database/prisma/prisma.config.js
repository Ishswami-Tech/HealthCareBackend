/**
 * Prisma 7 Configuration
 *
 * Prisma 7 requires a prisma.config.js file for configuration.
 * The datasource URL is configured here instead of in schema.prisma.
 *
 * This JavaScript file is used in both local development and production/Docker
 * environments since the Prisma CLI can load JavaScript files everywhere.
 *
 * @see https://www.prisma.io/docs/orm/reference/prisma-schema-reference#prisma-config-file
 */

// Simple function to get DATABASE_URL from environment
// CRITICAL: This function is called at module load time, so process.env must be set BEFORE requiring this file
function getCleanDatabaseUrl() {
  // CRITICAL FIX: In production deployments, DIRECT_URL might be set with wrong password
  //
  // WHY THIS MATTERS:
  // - Local-Prod: DATABASE_URL is set in docker-compose, DIRECT_URL from .env.local-prod is ignored
  //   → prisma.config.js reads DATABASE_URL (works fine)
  // - Production: .env.production loads DIRECT_URL into container at startup
  //   → Deployment script sets DATABASE_URL via docker exec (verified password)
  //   → OLD CODE prioritized DIRECT_URL (wrong password) over DATABASE_URL (correct password)
  //   → NEW CODE prioritizes DATABASE_URL (correct password) over DIRECT_URL
  //
  // We should ONLY use DIRECT_URL if DATABASE_URL is not available
  // For production migrations, we should prefer DATABASE_URL which is verified by deployment scripts

  // Priority 1: DATABASE_URL (preferred for migrations - verified by deployment scripts)
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && databaseUrl.trim() !== '') {
    // Remove Prisma-specific parameters that PostgreSQL doesn't recognize
    // These are handled by Prisma Client, not the PostgreSQL connection string
    let cleaned = databaseUrl.replace(
      /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g,
      ''
    );

    // Remove trailing '?' or '&' if cleaning left them
    cleaned = cleaned.replace(/[?&]$/, '');

    // Verify the cleaned URL still has a password (contains @ symbol after ://)
    // Also verify it's a valid PostgreSQL URL format
    const hasAtSymbol = cleaned.includes('@');
    const isPostgresUrl = cleaned.startsWith('postgresql://') || cleaned.startsWith('postgres://');

    if (!hasAtSymbol || !isPostgresUrl) {
      // Log error in all environments for debugging production issues
      const maskedUrl = cleaned.length > 50 ? cleaned.substring(0, 50) + '***' : cleaned;
      console.error('[prisma.config.js] ERROR: Invalid DATABASE_URL format');
      console.error('[prisma.config.js] Has @ symbol:', hasAtSymbol);
      console.error('[prisma.config.js] Is PostgreSQL URL:', isPostgresUrl);
      console.error('[prisma.config.js] Cleaned URL (masked):', maskedUrl);

      // If cleaned URL is invalid, try to use original (might have been over-cleaned)
      if (
        databaseUrl.includes('@') &&
        (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://'))
      ) {
        console.warn(
          '[prisma.config.js] WARNING: Using original DATABASE_URL (cleaning may have removed password)'
        );
        return databaseUrl;
      }

      // If original is also invalid, fall through to DIRECT_URL or return empty
    } else {
      // DATABASE_URL is valid and has password - use it (preferred)
      return cleaned;
    }
  }

  // Priority 2: DIRECT_URL (fallback - only if DATABASE_URL is not available or invalid)
  // NOTE: In production, DIRECT_URL might have wrong password, so we prefer DATABASE_URL
  const directUrl = process.env.DIRECT_URL;
  if (directUrl && directUrl.trim() !== '') {
    const isPostgresUrl =
      directUrl.startsWith('postgresql://') || directUrl.startsWith('postgres://');
    const hasAtSymbol = directUrl.includes('@');

    if (isPostgresUrl && hasAtSymbol) {
      return directUrl;
    } else {
      console.error('[prisma.config.js] ERROR: DIRECT_URL is invalid format');
    }
  }

  // No valid database URL found
  console.error(
    '[prisma.config.js] ERROR: Neither DATABASE_URL nor DIRECT_URL is set or valid in process.env'
  );
  console.error(
    '[prisma.config.js] DATABASE_URL present:',
    !!process.env.DATABASE_URL,
    'DIRECT_URL present:',
    !!process.env.DIRECT_URL
  );
  console.error(
    '[prisma.config.js] Available env vars:',
    Object.keys(process.env)
      .filter(k => k.includes('DATABASE') || k.includes('DIRECT'))
      .join(', ')
  );

  // Return empty string - Prisma will show a clear error
  return '';
}

// Get the database URL - this is called at module load time
// CRITICAL: Environment variables must be set before Prisma CLI loads this file
const databaseUrl = getCleanDatabaseUrl();

// Validate that we have a valid URL before exporting
if (!databaseUrl || databaseUrl.trim() === '') {
  const errorMsg =
    '[prisma.config.js] FATAL: No valid DATABASE_URL or DIRECT_URL found. ' +
    'Please ensure DATABASE_URL is set in the environment before running Prisma commands.';
  console.error(errorMsg);
  // Don't throw here - let Prisma CLI handle the error with a clearer message
} else {
  // Debug logging to help diagnose connection issues
  // Only log in non-production or when explicitly debugging
  if (process.env.DEBUG_PRISMA_CONFIG === 'true' || process.env.NODE_ENV !== 'production') {
    const urlParts = databaseUrl.match(/^(postgresql?:\/\/)([^:]+):([^@]+)@([^\/]+)\/(.+)$/);
    if (urlParts) {
      console.log('[prisma.config.js] Database URL parsed successfully');
      console.log('[prisma.config.js] Protocol:', urlParts[1]);
      console.log('[prisma.config.js] Username:', urlParts[2]);
      console.log(
        '[prisma.config.js] Password:',
        urlParts[3] ? urlParts[3].substring(0, 2) + '***' : 'MISSING'
      );
      console.log('[prisma.config.js] Host:', urlParts[4]);
      console.log('[prisma.config.js] Database:', urlParts[5]);
    } else {
      console.warn('[prisma.config.js] WARNING: Could not parse database URL format');
      console.warn('[prisma.config.js] URL (masked):', databaseUrl.substring(0, 30) + '***');
    }
  }
}

// Export Prisma 7 configuration
// Note: The URL is evaluated at module load time, so process.env must be set before this file is required
// CRITICAL: If databaseUrl is empty, Prisma will try to read from environment variables as fallback
// This provides a safety net if the config file can't read the URL
module.exports = {
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: './migrations',  // Relative to this config file (/app/src/libs/infrastructure/database/prisma/)
  },
  datasource: {
    // Use the cleaned URL, or let Prisma fall back to DATABASE_URL env var if empty
    // Prisma 7 supports reading from env vars even when using a config file
    url: databaseUrl || process.env.DATABASE_URL || process.env.DIRECT_URL || '',
  },
};
