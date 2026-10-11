/**
 * Imports the Vaidya Manager patient register (CSV export) into the Doctor APP.
 *
 *   node dist/scripts/vaidya-register-import/import-vaidya-register.js \
 *     --file /tmp/register.csv --clinic-id <clinic uuid> --actor-user-id <user uuid> \
 *     [--execute] [--limit-patients 50] [--batch-size 200] [--skip-clinical-text] [--report out.json]
 *
 * Without --execute nothing is written: the file is parsed, planned against what the database
 * already holds, and summarised. Re-running is safe: patients and visits written earlier are
 * recognised by their legacy register number and visit number and skipped.
 *
 * Environment: DATABASE_URL (required); FIELD_ENCRYPTION_KEY (required unless
 * --skip-clinical-text, because the register's diagnoses are clinical text and must not be stored
 * unencrypted).
 *
 * The output never contains names, numbers or diagnoses: counts only.
 */
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { Pool } from 'pg';
import { parseMasterKey } from '@infrastructure/database/config/field-crypto.util';
import { parseCsv } from './csv.util';
import { buildPlan } from './import-plan';
import {
  executePlan,
  loadExistingState,
  summarisePlan,
  verifyImport,
  type RunContext,
  type SqlExecutor,
  type TransactionalExecutor,
} from './import-runner';
import { assertRegisterHeader, mapRegisterRow, type MappedRegisterRow } from './register-mapper';

const DEFAULT_SOURCE = 'IMPORT:vaidya-register';
const DEFAULT_BATCH_SIZE = 200;
const PRISMA_ONLY_PARAMS = [
  'connection_limit',
  'pool_timeout',
  'schema',
  'pgbouncer',
  'statement_cache_size',
];

interface CliOptions {
  readonly file: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly execute: boolean;
  readonly limitPatients: number | undefined;
  readonly batchSize: number;
  readonly skipClinicalText: boolean;
  readonly report: string | undefined;
  readonly source: string;
}

class PgExecutor implements TransactionalExecutor {
  constructor(private readonly pool: Pool) {}

  async query<T = Record<string, unknown>>(
    text: string,
    params: unknown[] = []
  ): Promise<{ rows: T[] }> {
    const result = await this.pool.query(text, params);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: async <R = Record<string, unknown>>(text: string, params: unknown[] = []) => {
          const res = await client.query(text, params);
          return { rows: res.rows as R[] };
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values.set(name, next);
      i += 1;
    } else {
      flags.add(name);
    }
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const positiveInt = (name: string): number | undefined => {
    const raw = values.get(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1)
      throw new Error(`--${name} must be a positive integer`);
    return parsed;
  };
  return {
    file: required('file'),
    clinicId: required('clinic-id'),
    actorUserId: required('actor-user-id'),
    execute: flags.has('execute'),
    limitPatients: positiveInt('limit-patients'),
    batchSize: positiveInt('batch-size') ?? DEFAULT_BATCH_SIZE,
    skipClinicalText: flags.has('skip-clinical-text'),
    report: values.get('report'),
    source: values.get('source') ?? DEFAULT_SOURCE,
  };
}

/** Prisma-style URLs carry parameters the pg driver does not understand. */
export function pgConnectionString(url: string): string {
  const parsed = new URL(url);
  for (const param of PRISMA_ONLY_PARAMS) parsed.searchParams.delete(param);
  return parsed.toString();
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const rawKey = process.env['FIELD_ENCRYPTION_KEY'];
  const masterKey = rawKey ? parseMasterKey(rawKey) : null;

  // ---- read and map the file -------------------------------------------------------------
  const table = parseCsv(readFileSync(options.file, 'utf8'));
  const [header, ...records] = table;
  if (!header) throw new Error('The file is empty');
  assertRegisterHeader(header);

  const today = new Date();
  const mapped: MappedRegisterRow[] = [];
  const rejected = new Map<string, number>();
  records.forEach((cells, index) => {
    const result = mapRegisterRow(cells, index + 2, today);
    if (result.ok) mapped.push(result.row);
    else rejected.set(result.reason, (rejected.get(result.reason) ?? 0) + 1);
  });

  // ---- plan against the database -----------------------------------------------------------
  const pool = new Pool({ connectionString: pgConnectionString(databaseUrl), max: 4 });
  const db = new PgExecutor(pool);
  try {
    const clinic = await db.query(`SELECT 1 FROM "clinics" WHERE "id" = $1::text`, [
      options.clinicId,
    ]);
    if (clinic.rows.length === 0) throw new Error('Clinic not found');
    const actor = await db.query(`SELECT 1 FROM "users" WHERE "id" = $1::text`, [
      options.actorUserId,
    ]);
    if (actor.rows.length === 0) throw new Error('Actor user not found');

    const existing = await loadExistingState(db, options.clinicId);
    const plan = buildPlan(mapped, existing, {
      ...(options.limitPatients !== undefined ? { limitPatients: options.limitPatients } : {}),
    });
    const summary = summarisePlan(plan);
    const report: Record<string, unknown> = {
      mode: options.execute ? 'EXECUTE' : 'DRY_RUN',
      rowsRead: records.length,
      rowsMapped: mapped.length,
      rowsRejected: Object.fromEntries(rejected),
      dataQualityIssues: plan.issueCounts,
      plan: summary,
      clinicalTextWillBeWritten: !options.skipClinicalText,
      encryptionKeyConfigured: masterKey !== null,
    };
    out(JSON.stringify(report, null, 2));

    if (!options.execute) {
      if (options.report) writeFileSync(options.report, JSON.stringify(report, null, 2));
      out('Dry run: nothing was written. Re-run with --execute to import.');
      return 0;
    }

    // ---- guards before writing -----------------------------------------------------------
    const hasClinicalText = plan.patients.some(patient =>
      patient.visits.some(visit => visit.modernDiagnosis || visit.ayurvedicDiagnosis)
    );
    if (hasClinicalText && !options.skipClinicalText && !masterKey) {
      throw new Error(
        'The file contains diagnoses (clinical text) and FIELD_ENCRYPTION_KEY is not set. ' +
          'Set the key, or re-run with --skip-clinical-text to import everything else first.'
      );
    }

    const ctx: RunContext = {
      clinicId: options.clinicId,
      actorUserId: options.actorUserId,
      batchId: randomUUID(),
      source: options.source,
      batchSize: options.batchSize,
      masterKey,
      skipClinicalText: options.skipClinicalText,
    };
    const result = await executePlan(db, plan, ctx, (done, total) =>
      out(`progress ${done}/${total} patients`)
    );
    const verification = await verifyImport(db, options.clinicId, options.source);
    const finalReport = { ...report, result, verification, batchId: ctx.batchId };
    out(JSON.stringify({ result, verification }, null, 2));
    if (options.report) writeFileSync(options.report, JSON.stringify(finalReport, null, 2));
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `Import failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exit(1);
    }
  );
}

export { main, parseArgs };
