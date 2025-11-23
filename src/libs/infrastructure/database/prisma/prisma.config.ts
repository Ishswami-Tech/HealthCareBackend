import 'dotenv/config';

/**
 * Prisma 7 Configuration
 *
 * Prisma 7 requires a prisma.config.ts file for configuration.
 * The datasource URL is configured here instead of in schema.prisma.
 *
 * @see https://www.prisma.io/docs/orm/reference/prisma-schema-reference#prisma-config-file
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'src/libs/infrastructure/database/prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
