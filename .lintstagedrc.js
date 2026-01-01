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

  // Prisma schema changes trigger client regeneration
  '**/schema.prisma': [
    'prisma format --schema=./src/libs/infrastructure/database/prisma/schema.prisma --config=./src/libs/infrastructure/database/prisma/prisma.config.js',
    'node scripts/validate-prisma-generated.js --regenerate',
  ],

  // Prisma config changes also trigger regeneration
  '**/prisma.config.js': ['node scripts/validate-prisma-generated.js --regenerate'],

  // If generated files are modified, validate them
  '**/prisma/generated/**': ['node scripts/validate-prisma-generated.js --skip-comparison'],
};
