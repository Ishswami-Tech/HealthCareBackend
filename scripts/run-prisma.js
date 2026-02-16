#!/usr/bin/env node

/**
 * Consolidated Prisma Database Operations Script
 *
 * Handles all Prisma database operations:
 * - migrate deploy (production)
 * - db push (development)
 *
 * This script consolidates:
 * - run-migrations.js
 * - run-db-push.js
 */

const { execSync } = require('child_process');
const path = require('path');

// Use absolute paths (works in both local and Docker)
const projectRoot = path.join(__dirname, '..');
const schemaPath = path.join(projectRoot, 'src/libs/infrastructure/database/prisma/schema.prisma');
// Use JavaScript config for CLI (TypeScript config can't be loaded in production)
const configPath = path.join(
  projectRoot,
  'src/libs/infrastructure/database/prisma/prisma.config.js'
);
const args = process.argv.slice(2);
const command = args[0] || 'migrate'; // 'migrate' or 'push'

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Ensure DATABASE_URL is set (required by Prisma CLI)
if (!process.env.DATABASE_URL) {
  log('⚠ DATABASE_URL not found in environment', 'yellow');
  log('  Prisma commands require DATABASE_URL to be set', 'yellow');
  process.exit(1);
}

// Clean DATABASE_URL for Prisma CLI (remove Prisma-specific parameters)
// Prisma CLI needs a clean PostgreSQL connection string
// IMPORTANT: Prioritize DATABASE_URL over DIRECT_URL (matches prisma.config.js)
// In production, DIRECT_URL might be stale while DATABASE_URL is set by deployment scripts
function getCleanDatabaseUrl() {
  const dbUrl = process.env.DATABASE_URL || '';

  // Priority 1: DATABASE_URL (preferred - verified by deployment scripts)
  if (dbUrl && dbUrl.trim() !== '') {
    // Remove Prisma-specific parameters that PostgreSQL doesn't recognize
    let cleaned = dbUrl.replace(
      /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g,
      ''
    );
    // Remove trailing '?' or '&' if cleaning left them
    cleaned = cleaned.replace(/[?&]$/, '');
    return cleaned;
  }

  // Priority 2: DIRECT_URL (fallback - only if DATABASE_URL is not available)
  if (process.env.DIRECT_URL && process.env.DIRECT_URL.trim() !== '') {
    return process.env.DIRECT_URL;
  }

  return '';
}

const cleanDbUrl = getCleanDatabaseUrl();
if (!cleanDbUrl) {
  log('❌ DATABASE_URL is empty after cleaning', 'red');
  process.exit(1);
}

// Set cleaned DATABASE_URL in environment for Prisma CLI
// Prisma 7 can read from env var even with config file, but config file can't be loaded in production
// So we'll use DATABASE_URL directly via environment variable
const env = {
  ...process.env,
  DATABASE_URL: cleanDbUrl,
};

try {
  if (command === 'migrate' || command === 'deploy') {
    log('Running Prisma migrations (migrate deploy)...', 'cyan');
    log(`  Schema: ${schemaPath}`, 'cyan');
    log(`  Config: ${configPath}`, 'cyan');
    log(`  Database: ${cleanDbUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan');
    execSync(
      `node --max-old-space-size=8192 node_modules/prisma/build/index.js migrate deploy --schema=${schemaPath} --config=${configPath}`,
      {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        env: env,
      }
    );
    log('✓ Migrations completed successfully!', 'green');
    process.exit(0);
  } else if (command === 'push' || command === 'db-push') {
    log('Running Prisma db push (development mode)...', 'cyan');
    log(`  Schema: ${schemaPath}`, 'cyan');
    log(`  Config: ${configPath}`, 'cyan');
    log(`  Database: ${cleanDbUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan');
    execSync(
      `node --max-old-space-size=8192 node_modules/prisma/build/index.js db push --schema=${schemaPath} --config=${configPath} --accept-data-loss`,
      {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        env: env,
      }
    );
    log('✓ Database push completed successfully!', 'green');
    process.exit(0);
  } else {
    log(`Unknown command: ${command}`, 'red');
    log('Usage: node scripts/run-prisma.js [migrate|push]', 'yellow');
    log('  migrate (default) - Run migrations (production)', 'yellow');
    log('  push             - Push schema changes (development)', 'yellow');
    process.exit(1);
  }
} catch (error) {
  log(`❌ Prisma operation failed: ${error.message}`, 'red');
  process.exit(1);
}
