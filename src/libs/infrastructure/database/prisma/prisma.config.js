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
  // We should ONLY use DIRECT_URL if it's explicitly trusted (e.g., in local-prod where it's not set)
  // For production migrations, we should prefer DATABASE_URL which is verified by deployment scripts
  
  // Priority 1: DATABASE_URL (preferred for migrations - verified by deployment scripts)
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    // Remove Prisma-specific parameters that PostgreSQL doesn't recognize
    // These are handled by Prisma Client, not the PostgreSQL connection string
    const cleaned = databaseUrl.replace(
      /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g,
      ''
    );
    
    // Verify the cleaned URL still has a password (contains @ symbol after ://)
    if (!cleaned.includes('@')) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[prisma.config.js] ERROR: Cleaned DATABASE_URL is missing @ symbol (password missing?)');
        console.error('[prisma.config.js] Original URL (masked):', databaseUrl.substring(0, 30) + '***');
        console.error('[prisma.config.js] Cleaned URL (masked):', cleaned.substring(0, 30) + '***');
      }
      // If cleaned URL is invalid, fall through to DIRECT_URL or return empty
    } else {
      // DATABASE_URL is valid and has password - use it (preferred)
      return cleaned;
    }
  }

  // Priority 2: DIRECT_URL (fallback - only if DATABASE_URL is not available)
  // NOTE: In production, DIRECT_URL might have wrong password, so we prefer DATABASE_URL
  if (process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }

  // No valid database URL found
  if (process.env.NODE_ENV !== 'production') {
    console.error('[prisma.config.js] ERROR: Neither DATABASE_URL nor DIRECT_URL is set in process.env');
    console.error('[prisma.config.js] Available env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('DIRECT')).join(', '));
  }
  return '';
}

module.exports = {
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'src/libs/infrastructure/database/prisma/migrations',
  },
  datasource: {
    url: getCleanDatabaseUrl(),
  },
};
