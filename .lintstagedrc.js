/**
 * Lint-Staged Configuration
 *
 * Runs linters and formatters on staged files before commit.
 * This ensures code quality and prevents committing invalid code.
 */

module.exports = {
  // TypeScript files
  '**/*.ts': ['eslint --fix', 'prettier --write'],

  // JavaScript files
  '**/*.js': ['eslint --fix', 'prettier --write'],

  // JSON files
  '**/*.json': ['prettier --write'],

  // Markdown files
  '**/*.md': ['prettier --write'],

  // Prisma schema changes - format only (skip validation due to generation issues)
  // Prisma Client is generated during Docker build, not in pre-commit
  '**/schema.prisma': [
    'prisma format --schema=./src/libs/infrastructure/database/prisma/schema.prisma --config=./src/libs/infrastructure/database/prisma/prisma.config.js',
  ],

  // Prisma config changes - no action needed (validation handled in Docker build)
  // '**/prisma.config.js': [],

  // If generated files are modified - no action needed (validation handled in Docker build)
  // '**/prisma/generated/**': [],
};
