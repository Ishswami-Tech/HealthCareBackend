import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'src/libs/infrastructure/database/prisma/schema.prisma',
  migrations: {
    path: 'src/libs/infrastructure/database/prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
