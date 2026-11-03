#!/usr/bin/env node

/**
 * Deploy-time Prisma migration runner (production / preprod).
 *
 * Steps:
 *   1. `prisma migrate status` pre-check. Only an up-to-date database or pending migrations
 *      that have not been applied yet are allowed through. Failed migrations (P3009),
 *      history drift (migrations recorded in the DB that are not on disk) and an unmanaged
 *      schema (P3005) FAIL the deploy with a clear message. Nothing is auto-resolved.
 *   2. `prisma migrate deploy` (unless --status-only).
 *
 * Concurrency: `prisma migrate deploy` takes a Postgres advisory lock
 * (pg_advisory_lock(72707369)) for the whole run, so two replicas or a CI job and an
 * entrypoint run cannot apply the same migration twice. The loser waits for the lock and then
 * finds nothing pending.
 *
 * Timeouts: this process uses the raw DATABASE_URL through the Prisma CLI. The app-session
 * statement_timeout / lock_timeout are set in the PrismaService pool config, not in the URL,
 * so long DDL in a migration is not cut off by them.
 *
 * Usage (inside the production image, cwd /app):
 *   node scripts/deploy-migrate.js               # status pre-check, then deploy
 *   node scripts/deploy-migrate.js --status-only # pre-check only (runbook / dry run)
 *
 * Exit codes: 0 ok, 1 usage/env error, 2 failed migration, 3 drift, 4 unmanaged schema,
 *             5 unknown status output, 6 deploy failed.
 *
 * Never prints DATABASE_URL or any credential.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const schemaPath =
  process.env.PRISMA_SCHEMA_PATH ||
  path.join(projectRoot, 'src/libs/infrastructure/database/prisma/schema.prisma');
const configPath = path.join(
  projectRoot,
  'src/libs/infrastructure/database/prisma/prisma.config.js'
);
const prismaCli = path.join(projectRoot, 'node_modules/prisma/build/index.js');
const statusOnly = process.argv.includes('--status-only');
const CLI_TIMEOUT_MS = Number(process.env.MIGRATE_TIMEOUT_MS || 15 * 60 * 1000);

// Prisma-only / pool-only query params that the Postgres wire protocol does not understand.
const STRIPPED_PARAMS =
  /[?&](connection_limit|pool_timeout|statement_timeout|idle_in_transaction_session_timeout|connect_timeout|pool_size|max_connections)=[^&]*/g;

function log(message) {
  console.log(`[migrate] ${message}`);
}

function fail(code, message, details) {
  console.error(`[migrate] ERROR: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(code);
}

function cleanDatabaseUrl(raw) {
  return raw.replace(STRIPPED_PARAMS, '').replace(/\?&/, '?').replace(/[?&]$/, '');
}

function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

const rawUrl = (process.env.DATABASE_URL || '').trim();
if (!rawUrl) {
  fail(1, 'DATABASE_URL is not set. Refusing to run migrations.');
}

const env = { ...process.env, DATABASE_URL: cleanDatabaseUrl(rawUrl) };
delete env.DIRECT_URL;

function runPrisma(args) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, ...args, '--schema', schemaPath, '--config', configPath],
    {
      cwd: projectRoot,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
    }
  );
  if (result.error) {
    fail(1, `Could not run the Prisma CLI: ${result.error.message}`);
  }
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Classify `prisma migrate status` output. Order matters: failure and drift are checked before
 * "pending", because a diverged history also prints a "not yet been applied" list.
 */
function classifyStatus(output, exitCode) {
  if (/P3009|migrations? (?:have|has) failed|failed migrations?/i.test(output)) {
    return 'failed';
  }
  if (
    /not found locally|different from the migrations table|have diverged|last common migration/i.test(
      output
    )
  ) {
    return 'drift';
  }
  if (/P3005|not managed by Prisma Migrate|schema is not empty/i.test(output)) {
    return 'unmanaged';
  }
  if (/Database schema is up to date/i.test(output) && exitCode === 0) {
    return 'up-to-date';
  }
  if (/have not yet been applied/i.test(output)) {
    return 'pending';
  }
  return 'unknown';
}

function listPending(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex(line => /have not yet been applied/i.test(line));
  if (start < 0) return [];
  const names = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^\d{14}_[\w-]+$/.test(trimmed)) {
      names.push(trimmed);
    } else if (names.length > 0 && trimmed === '') {
      break;
    }
  }
  return names;
}

log(`Target database: ${describeTarget(env.DATABASE_URL)}`);
log('Step 1/2: prisma migrate status (pre-check)');
const status = runPrisma(['migrate', 'status']);
const state = classifyStatus(status.output, status.status);

switch (state) {
  case 'up-to-date':
    log('Database schema is up to date. Nothing to apply.');
    process.exit(0);
    break;
  case 'failed':
    fail(
      2,
      'A previous migration is recorded as FAILED. Deploy stopped. Fix it by hand on a prod copy ' +
        'first (see docs/DEPLOY_MIGRATIONS.md), then `prisma migrate resolve`.',
      status.output
    );
    break;
  case 'drift':
    fail(
      3,
      'Migration history DRIFT: the database migration table and the migrations on disk disagree. ' +
        'Deploy stopped. Reconcile on a prod copy first (see docs/DEPLOY_MIGRATIONS.md).',
      status.output
    );
    break;
  case 'unmanaged':
    fail(
      4,
      'The database is not managed by Prisma Migrate (no baseline). Deploy stopped. Baseline it ' +
        'with `prisma migrate resolve --applied` (see docs/DEPLOY_MIGRATIONS.md).',
      status.output
    );
    break;
  case 'unknown':
    fail(5, 'Could not interpret `prisma migrate status` output. Deploy stopped.', status.output);
    break;
  default:
    break;
}

const pending = listPending(status.output);
log(`Pending migrations (${pending.length}):`);
for (const name of pending) {
  log(`  - ${name}`);
}

if (statusOnly) {
  log('--status-only: not applying anything.');
  process.exit(0);
}

log('Step 2/2: prisma migrate deploy (holds the Prisma advisory lock while it runs)');
const deploy = runPrisma(['migrate', 'deploy']);
process.stdout.write(deploy.output);
if (deploy.status !== 0) {
  fail(
    6,
    '`prisma migrate deploy` failed. The new release must NOT be started. The failing migration ' +
      'is now recorded as failed; follow docs/DEPLOY_MIGRATIONS.md to recover.'
  );
}
log('Migrations applied successfully.');
process.exit(0);
