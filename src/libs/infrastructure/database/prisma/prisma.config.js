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
function getCleanDatabaseUrl() {
  // Priority 1: DIRECT_URL (clean connection string, highest priority)
  if (process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }

  // Priority 2: DATABASE_URL from environment (Docker or system env)
  const databaseUrl = process.env.DATABASE_URL;
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

module.exports = {
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'src/libs/infrastructure/database/prisma/migrations',
  },
  datasource: {
    url: getCleanDatabaseUrl(),
  },
};
