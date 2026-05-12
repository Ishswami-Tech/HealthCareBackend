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

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
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

function runPrismaCli(args, options = {}) {
  const result = spawnSync(
    'node',
    ['--max-old-space-size=8192', 'node_modules/prisma/build/index.js', ...args],
    {
      cwd: path.join(__dirname, '..'),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }
  );

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(`Prisma command failed with exit code ${result.status}`);
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    error.status = result.status;
    throw error;
  }

  return result;
}

function readMigrationSql(migrationName) {
  const migrationPath = path.join(
    projectRoot,
    'src/libs/infrastructure/database/prisma/migrations',
    migrationName,
    'migration.sql'
  );

  if (!fs.existsSync(migrationPath)) {
    return null;
  }

  return fs.readFileSync(migrationPath, 'utf8');
}

function extractMigrationName(output) {
  const match = output.match(/The `([^`]+)` migration started/i);
  return match ? match[1] : '';
}

function extractCreatedObjects(sql) {
  const tables = new Set();
  const types = new Set();

  for (const match of sql.matchAll(/CREATE TABLE\s+"([^"]+)"/gi)) {
    tables.add(match[1]);
  }

  for (const match of sql.matchAll(/CREATE TYPE\s+"([^"]+)"/gi)) {
    types.add(match[1]);
  }

  return { tables: [...tables], types: [...types] };
}

function queryDatabase(sql) {
  const psqlUrl = cleanDbUrl.replace(/[?&]schema=[^&]*/g, '').replace(/[?&]$/, '');
  return execFileSync('psql', ['-d', psqlUrl, '-tAc', sql], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isSafeToResolveFailedMigration(migrationName) {
  const migrationSql = readMigrationSql(migrationName);
  if (!migrationSql) {
    log(`❌ Migration SQL not found for ${migrationName}`, 'red');
    return false;
  }

  const { tables, types } = extractCreatedObjects(migrationSql);
  if (tables.length === 0 && types.length === 0) {
    log(`⚠ No CREATE TABLE or CREATE TYPE statements found in ${migrationName}`, 'yellow');
    return false;
  }

  try {
    for (const tableName of tables) {
      const result = queryDatabase(`SELECT to_regclass('"${tableName}"') IS NOT NULL;`);
      if (result !== 't') {
        log(`⚠ Missing table for recovery: ${tableName}`, 'yellow');
        return false;
      }
    }

    for (const typeName of types) {
      const result = queryDatabase(
        `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typeName}');`
      );
      if (result !== 't') {
        log(`⚠ Missing enum/type for recovery: ${typeName}`, 'yellow');
        return false;
      }
    }
  } catch (error) {
    log(`❌ Failed while validating migration state: ${error.message}`, 'red');
    return false;
  }

  return true;
}

function attemptP3009Recovery(output) {
  const failedMigrationName = extractMigrationName(output);
  if (!failedMigrationName) {
    log('❌ Could not determine failed migration name from Prisma output', 'red');
    return false;
  }

  log(`⚠ Detected failed migration: ${failedMigrationName}`, 'yellow');

  if (!isSafeToResolveFailedMigration(failedMigrationName)) {
    log('❌ Auto-resolve skipped because the database state is not safe', 'red');
    return false;
  }

  log(`ℹ Safe to resolve failed migration as applied: ${failedMigrationName}`, 'cyan');
  try {
    runPrismaCli([
      'migrate',
      'resolve',
      '--applied',
      failedMigrationName,
      '--schema',
      schemaPath,
      '--config',
      configPath,
    ]);
  } catch (error) {
    log(`❌ Failed to resolve migration as applied: ${failedMigrationName}`, 'red');
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    return false;
  }

  log(`✅ Resolved failed migration as applied: ${failedMigrationName}`, 'green');

  try {
    runPrismaCli(['migrate', 'deploy', '--schema', schemaPath, '--config', configPath]);
    log('✅ Migrations completed successfully after recovery!', 'green');
    return true;
  } catch (error) {
    log('❌ Migration still failed after resolving failed migration', 'red');
    if (error.stdout) console.error(error.stdout.toString());
    if (error.stderr) console.error(error.stderr.toString());
    return false;
  }
}

try {
  if (command === 'migrate' || command === 'deploy') {
    log('Running Prisma migrations (migrate deploy)...', 'cyan');
    log(`  Schema: ${schemaPath}`, 'cyan');
    log(`  Config: ${configPath}`, 'cyan');
    log(`  Database: ${cleanDbUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan');
    try {
      runPrismaCli(['migrate', 'deploy', '--schema', schemaPath, '--config', configPath]);
    } catch (error) {
      const output = `${error.stdout ? error.stdout.toString() : ''}${error.stderr ? error.stderr.toString() : ''}${error.message || ''}`;
      if (output.includes('P3009') && attemptP3009Recovery(output)) {
        process.exit(0);
      }
      throw error;
    }
    log('✓ Migrations completed successfully!', 'green');
    process.exit(0);
  } else if (command === 'push' || command === 'db-push') {
    log('Running Prisma db push (development mode)...', 'cyan');
    log(`  Schema: ${schemaPath}`, 'cyan');
    log(`  Config: ${configPath}`, 'cyan');
    log(`  Database: ${cleanDbUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan');
    runPrismaCli(['db', 'push', '--schema', schemaPath, '--config', configPath, '--accept-data-loss']);
    log('✓ Database push completed successfully!', 'green');
    process.exit(0);
  } else if (command === 'validate') {
    log('Running Prisma schema validation...', 'cyan');
    log(`  Schema: ${schemaPath}`, 'cyan');
    log(`  Config: ${configPath}`, 'cyan');
    runPrismaCli(['validate', '--schema', schemaPath, '--config', configPath]);
    log('✓ Schema validation passed!', 'green');
    process.exit(0);
  } else {
    log(`Unknown command: ${command}`, 'red');
    log('Usage: node scripts/run-prisma.js [migrate|push|validate]', 'yellow');
    log('  migrate  - Run migrations (production)', 'yellow');
    log('  push     - Push schema changes (development)', 'yellow');
    log('  validate - Validate schema syntax', 'yellow');
    process.exit(1);
  }
} catch (error) {
  console.error(`${colors.red}❌ Prisma operation failed: ${error.message}${colors.reset}`);
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  process.exit(1);
}
