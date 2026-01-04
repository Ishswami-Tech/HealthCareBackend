/**
 * Lint-Staged Configuration
 *
 * Runs linters and formatters on staged files before commit.
 * This ensures code quality and prevents committing invalid code.
 */

module.exports = {
  // TypeScript files
  '**/*.ts': ['eslint --fix', 'prettier --write'],

  // JavaScript files (exclude scripts from ESLint - they use CommonJS and don't need TypeScript rules)
  '**/*.js': [
    (filenames) => {
      const scriptFiles = filenames.filter((f) => f.includes('scripts/'));
      const otherFiles = filenames.filter((f) => !f.includes('scripts/'));
      const commands = [];
      if (otherFiles.length > 0) {
        commands.push(`eslint --fix ${otherFiles.map((f) => `"${f}"`).join(' ')}`);
      }
      if (scriptFiles.length > 0) {
        commands.push(`prettier --write ${scriptFiles.map((f) => `"${f}"`).join(' ')}`);
      }
      return commands;
    },
  ],

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
