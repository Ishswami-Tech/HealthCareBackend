/**
 * Prisma 7 Configuration
 *
 * Prisma 7 requires a prisma.config.ts file for configuration.
 * The datasource URL is configured here instead of in schema.prisma.
 *
 * @see https://www.prisma.io/docs/orm/reference/prisma-schema-reference#prisma-config-file
 */
import { defineConfig } from 'prisma/config';
// Use relative path instead of path alias - Prisma config loader doesn't resolve TypeScript path aliases
import { getEnv, isDockerEnvironment } from '../../../../config/environment/utils';
// Import dotenv for local development (strict TypeScript compliance - no require())
import * as dotenv from 'dotenv';

/**
 * Load environment variables with proper precedence:
 * 1. System environment variables (highest priority - Docker, CI/CD, etc.)
 * 2. .env file (for local development)
 *
 * In Docker, environment variables from docker-compose take precedence over .env file
 */
function loadEnvWithPrecedence(): void {
  // Only load .env if not running in Docker (where env vars are already set)
  // Check if we're in Docker using helper function
  const isDocker = isDockerEnvironment() || (getEnv('DATABASE_URL') || '').includes('@postgres:');

  if (!isDocker) {
    // Load .env file for local development (outside Docker)
    try {
      dotenv.config();
    } catch {
      // dotenv not available, that's fine
    }
  }
  // In Docker, environment variables are already set, no need to load .env
}

// Load environment with proper precedence
loadEnvWithPrecedence();

/**
 * Clean DATABASE_URL by removing Prisma-specific parameters
 * Prisma Studio needs a clean PostgreSQL connection string
 * Parameters like connection_limit, pool_timeout are Prisma client settings, not PostgreSQL connection parameters
 */
function getCleanDatabaseUrl(): string {
  // Priority 1: DIRECT_URL (clean connection string, highest priority)
  const directUrl = getEnv('DIRECT_URL');
  if (directUrl) {
    return directUrl; // DIRECT_URL should be a clean connection string
  }

  // Priority 2: DATABASE_URL from environment (Docker or system env)
  const databaseUrl = getEnv('DATABASE_URL') || '';
  if (!databaseUrl) {
    return '';
  }

  // Remove Prisma-specific parameters that PostgreSQL doesn't recognize
  // These are handled by Prisma Client, not the PostgreSQL connection string
  return databaseUrl.replace(
    /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g,
    ''
  );
}

export default defineConfig({
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'src/libs/infrastructure/database/prisma/migrations',
  },
  datasource: {
    url: getCleanDatabaseUrl(),
  },
});
