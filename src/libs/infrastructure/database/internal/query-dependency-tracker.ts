/**
 * Query dependency tracking for the database query cache.
 * =========================================================
 * The query cache (DatabaseService.executeRead -> QueryCacheService -> CacheService L1/L2) used to
 * tag every entry only `database` + `read`, because nothing knew which tables a read touched. The
 * only safe invalidation was then the global `database` tag, which every write cleared, so any
 * write anywhere emptied the whole query cache (measured live: ~4% hit rate, every repeat miss
 * preceded by a mass UNLINK of 70-140 keys).
 *
 * A Prisma query extension (installed by PrismaService on the shared client) reports every
 * operation here. Inside a tracking scope opened by DatabaseService it records:
 *   - reads: the tables the read depends on - the model itself plus every model reached through a
 *     relation field anywhere in the arguments (include / select / where / orderBy / _count / ...),
 *     resolved with the generated client's DMMF;
 *   - writes: the tables the write changes, including nested writes through relation fields.
 * Anything that cannot be attributed to tables (raw SQL, an unknown schema) marks the scope
 * `untracked`, and DatabaseService falls back to the old global tags for it, so an untracked read
 * is never served stale.
 *
 * Writes made outside any DatabaseService write scope (direct `db.prisma.<model>.create(...)` in
 * services, interactive transactions opened by services) are reported to the registered
 * write listener after they succeed, so they invalidate the tables they touched instead of
 * relying on some other write's global wipe.
 *
 * Tags use the same convention as DatabaseService.generateCacheTags: the snake_case model name
 * (`HealthRecord` -> `health_record`), i.e. what `auditInfo.resourceType.toLowerCase()` produces.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Minimal shape of the generated client's `Prisma.dmmf` that this module needs. */
export interface QueryTrackingDmmf {
  datamodel: {
    models: ReadonlyArray<{
      name: string;
      fields: ReadonlyArray<{ name: string; kind: string; type: string }>;
    }>;
  };
}

/**
 * A value inside Prisma operation arguments (or a raw query's arguments / result): scalars,
 * dates, nested argument objects, `Sql` objects and arrays of these.
 */
export type PrismaArgValue =
  string | number | boolean | bigint | null | undefined | Date | object | readonly PrismaArgValue[];

/** Tables one scope (or one operation) depends on / changes. */
export interface TableSet {
  /** Snake_case table tags, e.g. `appointment`, `health_record`. */
  readonly tables: Set<string>;
  /** True when part of the work could not be attributed to tables (raw SQL, unknown model). */
  untracked: boolean;
}

export interface QueryTrackingScope {
  readonly kind: 'read' | 'write';
  /** Tables the scope read from. */
  readonly read: TableSet;
  /** Tables the scope wrote to. */
  readonly written: TableSet;
  /**
   * The scope that was active when this one started (set by runWithQueryTracking). Operations are
   * recorded in every enclosing scope too, so an outer transaction still sees - and invalidates
   * after its commit - the writes of an executeWrite/executeRead nested inside it.
   */
  parent?: QueryTrackingScope;
  /**
   * Set once the scope's operation has finished. Async work it started (fire-and-forget calls,
   * timers) keeps the scope in its async context; such late operations are treated as outside
   * any scope, so their writes are reported instead of being added to an invalidation that
   * already ran.
   */
  closed?: boolean;
}

/** What one Prisma operation does to the data, as far as the cache is concerned. */
export interface OperationEffect {
  readonly reads: TableSet | null;
  readonly writes: TableSet | null;
}

/** Called after a successful write that ran outside a DatabaseService write scope. */
export type UntrackedWriteListener = (writes: TableSet) => void;

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const RAW_READ_OPERATIONS = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$queryRawTyped',
  '$runCommandRaw',
]);
const RAW_WRITE_OPERATIONS = new Set(['$executeRaw', '$executeRawUnsafe']);

/**
 * A whole statement that only takes an advisory lock (`SELECT pg_advisory_xact_lock(...)` and
 * friends) changes no rows; the app sends them through $executeRaw (booking, billing and invoice
 * numbering do). Treating them as writes would wipe the whole query cache on every booking. The
 * entire statement must be the lock call: a write after it in the same string is not hidden.
 */
const ADVISORY_LOCK_SQL =
  /^\s*select\s+pg_(try_)?advisory_(xact_)?(un)?lock(_shared)?(_all)?\s*\([^;]*\)\s*;?\s*$/i;

/**
 * Keywords that make raw SQL a write. Raw SQL is classified by its text, not by the method that
 * sent it: the app runs `UPDATE ... RETURNING` through $queryRaw (startVisitAtomically,
 * the location-token allocator), which a method-based rule would count as a read.
 */
const RAW_WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|truncate|copy|call|create|alter|drop|refresh|vacuum|reindex)\b/i;
/** Removed before the keyword scan: quoted text and row-lock clauses are not writes. */
const SQL_STRING_LITERALS = /'(?:[^']|'')*'|"(?:[^"]|"")*"/g;
const SQL_ROW_LOCK_CLAUSES = /\bfor\s+(no\s+key\s+update|update|key\s+share|share)\b/gi;

/** Prefix of table cache tags, e.g. `tbl:appointment` (see tableCacheTag). */
export const TABLE_TAG_PREFIX = 'tbl:';

/**
 * Deletes are treated as touching everything: the schema has onDelete Cascade / SetNull /
 * SetDefault relations, and the database changes those child rows itself. The runtime DMMF does not
 * carry onDelete, so they cannot be attributed to tables.
 */
const DELETE_OPERATIONS = new Set(['delete', 'deleteMany']);
/** The same deletes nested inside a write's `data` (`items: { deleteMany: {...} }`). */
const NESTED_DELETE_KEYS = new Set(['delete', 'deleteMany']);

/**
 * The argument keys that describe what a write changes. `where` (which rows), `include` / `select`
 * (the returned shape) and similar keys read related tables but do not change them.
 */
const WRITE_DATA_KEYS = ['data', 'create', 'update'] as const;

/** Bounds the argument walk; Prisma arguments are shallow, this only guards pathological input. */
const MAX_WALK_DEPTH = 16;

/**
 * Existing global query-cache tag. Kept on reads that could not be attributed to tables, and
 * invalidated by every write, so those reads behave exactly as before.
 */
export const UNTRACKED_READ_TAG = 'database';
/** Carried by every query-cache entry; invalidating it empties the whole query cache. */
export const ALL_QUERY_CACHE_TAG = 'read';

const storage = new AsyncLocalStorage<QueryTrackingScope>();
let relationsByModel: Map<string, Map<string, string>> | null = null;
/** Json scalar fields per model: their values are data, never relation arguments. */
let jsonFieldsByModel = new Map<string, Set<string>>();
let knownTableTags = new Set<string>();
let untrackedWriteListener: UntrackedWriteListener | null = null;

/**
 * Loads the relation map from the generated client's DMMF. Until this runs (or if the DMMF is
 * missing) every operation counts as untracked, which keeps the old global invalidation.
 */
export function configureQueryTrackingSchema(dmmf: QueryTrackingDmmf | undefined | null): void {
  // No Array.isArray: it narrows the readonly array to any[].
  const models: QueryTrackingDmmf['datamodel']['models'] | undefined = dmmf?.datamodel?.models;
  if (!models || models.length === 0) {
    relationsByModel = null;
    jsonFieldsByModel = new Map();
    knownTableTags = new Set();
    return;
  }
  const map = new Map<string, Map<string, string>>();
  const jsonFields = new Map<string, Set<string>>();
  const tags = new Set<string>();
  for (const model of models) {
    const relations = new Map<string, string>();
    const json = new Set<string>();
    for (const field of model.fields) {
      if (field.kind === 'object') relations.set(field.name, field.type);
      else if (field.kind === 'scalar' && field.type === 'Json') json.add(field.name);
    }
    map.set(model.name, relations);
    jsonFields.set(model.name, json);
    tags.add(tableCacheTag(model.name));
  }
  relationsByModel = map;
  jsonFieldsByModel = jsonFields;
  knownTableTags = tags;
}

export function isQueryTrackingConfigured(): boolean {
  return relationsByModel !== null;
}

/** True for a tag that names a table of the current schema (e.g. `tbl:appointment`). */
export function isTableTag(tag: string): boolean {
  return knownTableTags.has(tag);
}

/**
 * The table cache tag for an entity / resource type name in any casing (`HealthRecord`,
 * `HEALTH_RECORD`, `health_record` -> `tbl:health_record`), or null when no such table exists.
 */
export function tableCacheTagForEntity(entityType: string): string | null {
  const tag = TABLE_TAG_PREFIX + tableTag(entityType);
  return knownTableTags.has(tag) ? tag : null;
}

/** Query-cache tags for a read: its tables, or the global tag when it is not fully attributed. */
export function readDependencyTags(read: TableSet): string[] {
  const tags = [...read.tables];
  if (read.untracked || read.tables.size === 0) tags.push(UNTRACKED_READ_TAG);
  return tags;
}

/**
 * Tags a committed write must invalidate: the tables it changed, plus the global tag so reads
 * that could not be attributed to tables still refresh on every write (as before). A write that
 * could not be attributed (raw SQL) - or, with `assumeAnyWhenNothingSeen`, a write scope in which
 * no write was observed at all - empties the whole query cache.
 */
export function writeInvalidationTags(
  written: TableSet,
  options: { assumeAnyWhenNothingSeen: boolean }
): string[] {
  const tags = new Set<string>(written.tables);
  tags.add(UNTRACKED_READ_TAG);
  if (written.untracked || (options.assumeAnyWhenNothingSeen && written.tables.size === 0)) {
    tags.add(ALL_QUERY_CACHE_TAG);
  }
  return [...tags];
}

/** Registers the single listener for writes made outside a DatabaseService write scope. */
export function setUntrackedWriteListener(listener: UntrackedWriteListener | null): void {
  untrackedWriteListener = listener;
}

/** `HealthRecord` -> `health_record`, `RbacRole` -> `rbac_role`, `EHRNote` -> `ehr_note`. */
export function tableTag(modelName: string): string {
  return modelName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Cache tag of a table: `tbl:<snake_case model>`. The prefix keeps table tags apart from the
 * service-level entity tags (`appointment`, `patients`, ...) and, because it contains `:`, out of
 * the per-clinic collection-tag expansion (tag-scope.util), which never prunes those sets.
 */
export function tableCacheTag(modelName: string): string {
  return TABLE_TAG_PREFIX + tableTag(modelName);
}

export function emptyTableSet(): TableSet {
  return { tables: new Set<string>(), untracked: false };
}

export function newQueryTrackingScope(kind: 'read' | 'write'): QueryTrackingScope {
  return { kind, read: emptyTableSet(), written: emptyTableSet() };
}

/**
 * Runs `fn` with `scope` as the active tracking scope (nested scopes replace the outer one).
 *
 * The result is awaited INSIDE the scope on purpose: Prisma promises are lazy and only run their
 * query when `.then()` is called. An operation like `prisma => prisma.user.findUnique(...)` returns
 * the PrismaPromise un-awaited; without this `await` the query would start after `run()` returned,
 * outside the scope, and never be recorded (verified against Prisma 7.10).
 */
export function runWithQueryTracking<T>(
  scope: QueryTrackingScope,
  fn: () => Promise<T>
): Promise<T> {
  const enclosing = openScope(storage.getStore());
  // A retried operation runs the same scope again: never make a scope its own ancestor.
  if (!scope.parent && enclosing && enclosing !== scope) scope.parent = enclosing;
  scope.closed = false;
  return storage.run(scope, async () => {
    try {
      return await fn();
    } finally {
      scope.closed = true;
    }
  });
}

/** The nearest scope in the chain that is still running (see QueryTrackingScope.closed). */
function openScope(scope: QueryTrackingScope | undefined): QueryTrackingScope | undefined {
  let current = scope;
  while (current?.closed) current = current.parent;
  return current;
}

/**
 * Runs a transaction the caller opened itself (PrismaService.$transaction) in a write scope, and
 * reports what it wrote to the write listener after it committed - unless an enclosing
 * executeWrite/executeTransaction scope will invalidate it after its own commit. Without this,
 * its writes were reported one by one before the commit, letting a concurrent read re-cache the
 * pre-commit rows.
 */
export async function runInTransactionScope<T>(fn: () => Promise<T>): Promise<T> {
  const scope = newQueryTrackingScope('write');
  const result = await runWithQueryTracking(scope, fn);
  if (
    !hasOpenWriteScope(scope.parent) &&
    (scope.written.tables.size > 0 || scope.written.untracked)
  ) {
    reportUntrackedWrite(scope.written);
  }
  return result;
}

function hasOpenWriteScope(scope: QueryTrackingScope | undefined): boolean {
  for (let current = openScope(scope); current; current = openScope(current.parent)) {
    if (current.kind === 'write') return true;
  }
  return false;
}

/**
 * A cache hit inside a running scope (e.g. a cached executeRead nested in another executeRead)
 * runs no query, so the enclosing reads cannot learn its tables: mark them untracked.
 */
export function markEnclosingReadsUntracked(): void {
  for (let current = openScope(storage.getStore()); current; current = openScope(current.parent)) {
    current.read.untracked = true;
  }
}

export function currentQueryTrackingScope(): QueryTrackingScope | undefined {
  return storage.getStore();
}

export function mergeTableSet(into: TableSet, from: TableSet): void {
  for (const table of from.tables) into.tables.add(table);
  if (from.untracked) into.untracked = true;
}

/**
 * Adds `modelName` and every model reached through a relation field anywhere in `args`.
 * Keys that are not relation fields of the current model (where/include/select/AND/some/data/...)
 * are walked with the same model, so relation names are found at any depth. Over-collecting is
 * safe (an extra invalidation); under-collecting would serve stale data, so unknown models make
 * the set untracked.
 */
export function collectModelTables(modelName: string, args: PrismaArgValue, into: TableSet): void {
  const relations = relationsByModel?.get(modelName);
  if (!relations) {
    into.untracked = true;
    return;
  }
  into.tables.add(tableCacheTag(modelName));
  walk(modelName, args, 0, { into, seen: new WeakMap<object, Set<string>>() });
}

/** Shared by one argument walk: the result set, and which (object, model) pairs were walked. */
interface WalkState {
  readonly into: TableSet;
  readonly seen: WeakMap<object, Set<string>>;
}

function walk(modelName: string, value: PrismaArgValue, depth: number, state: WalkState): void {
  const { into, seen } = state;
  if (value === null || typeof value !== 'object') return;
  if (depth > MAX_WALK_DEPTH) {
    into.untracked = true;
    return;
  }
  // Keyed by model too: an object reused under two relations must be walked under each model.
  const walkedAs = seen.get(value) ?? new Set<string>();
  if (walkedAs.has(modelName)) return;
  walkedAs.add(modelName);
  seen.set(value, walkedAs);
  if (value instanceof Date || ArrayBuffer.isView(value)) return;

  if (Array.isArray(value)) {
    // Array.isArray narrows to any[]; keep the element type.
    for (const item of value as readonly PrismaArgValue[]) {
      walk(modelName, item, depth + 1, state);
    }
    return;
  }

  const relations = relationsByModel?.get(modelName);
  const jsonFields = jsonFieldsByModel.get(modelName);
  for (const [key, child] of Object.entries(value as Record<string, PrismaArgValue>)) {
    if (jsonFields?.has(key)) continue; // data, not arguments
    // `_count: true` counts every relation list of the model.
    if (key === '_count' && child === true) {
      for (const relatedModel of relations?.values() ?? []) {
        into.tables.add(tableCacheTag(relatedModel));
      }
      continue;
    }
    // A nested delete triggers the same database cascades as a top-level one.
    if (NESTED_DELETE_KEYS.has(key)) into.untracked = true;
    const related = relations?.get(key);
    if (related) {
      if (!relationsByModel?.has(related)) {
        into.untracked = true;
        continue;
      }
      into.tables.add(tableCacheTag(related));
      walk(related, child, depth + 1, state);
    } else {
      walk(modelName, child, depth + 1, state);
    }
  }
}

/** True when raw SQL can change rows (see RAW_WRITE_KEYWORDS); unknown SQL counts as a write. */
function rawSqlWrites(sql: string | null): boolean {
  if (sql === null) return true;
  if (ADVISORY_LOCK_SQL.test(sql)) return false;
  const code = sql.replace(SQL_STRING_LITERALS, "''").replace(SQL_ROW_LOCK_CLAUSES, '');
  return RAW_WRITE_KEYWORDS.test(code);
}

/** SQL text of a raw operation's arguments, when it can be recovered. */
function rawSqlText(args: PrismaArgValue): string | null {
  if (typeof args === 'string') return args;
  if (Array.isArray(args)) {
    const first: PrismaArgValue = (args as readonly PrismaArgValue[])[0];
    if (typeof first === 'string') return first;
    if (Array.isArray(first) && first.every(part => typeof part === 'string')) {
      return (first as string[]).join('?');
    }
    return null;
  }
  if (args && typeof args === 'object') {
    const sql = (args as { sql?: PrismaArgValue }).sql;
    if (typeof sql === 'string') return sql;
    const strings = (args as { strings?: PrismaArgValue }).strings;
    if (Array.isArray(strings) && strings.every(part => typeof part === 'string')) {
      return (strings as string[]).join('?');
    }
  }
  return null;
}

/** Only the parts of a write's arguments that describe what it changes (see WRITE_DATA_KEYS). */
function writeDataOf(args: PrismaArgValue): PrismaArgValue {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const source = args as Record<string, PrismaArgValue>;
  const picked: Record<string, PrismaArgValue> = {};
  for (const key of WRITE_DATA_KEYS) {
    if (key in source) picked[key] = source[key];
  }
  return picked;
}

/** True for an operation that only reads (so recording it is useless without a scope). */
function isReadOnlyOperation(
  model: string | undefined,
  operation: string,
  args: PrismaArgValue
): boolean {
  if (model) return READ_OPERATIONS.has(operation);
  return RAW_READ_OPERATIONS.has(operation) && !rawSqlWrites(rawSqlText(args));
}

/** Classifies one Prisma operation. */
export function describeOperation(
  model: string | undefined,
  operation: string,
  args: PrismaArgValue
): OperationEffect {
  if (!model) {
    if (RAW_READ_OPERATIONS.has(operation) || RAW_WRITE_OPERATIONS.has(operation)) {
      const sql = rawSqlText(args);
      if (sql !== null && ADVISORY_LOCK_SQL.test(sql)) return { reads: null, writes: null };
      // Classified by the SQL, whichever method sent it ($queryRaw also runs UPDATE ... RETURNING).
      const writes = rawSqlWrites(sql) ? { tables: new Set<string>(), untracked: true } : null;
      const reads = RAW_READ_OPERATIONS.has(operation)
        ? { tables: new Set<string>(), untracked: true }
        : null;
      return { reads, writes };
    }
    // Any other model-less operation: assume it may read and write anything.
    return {
      reads: { tables: new Set(), untracked: true },
      writes: { tables: new Set(), untracked: true },
    };
  }

  if (READ_OPERATIONS.has(operation)) {
    const tables = emptyTableSet();
    collectModelTables(model, args, tables);
    return { reads: tables, writes: null };
  }
  if (WRITE_OPERATIONS.has(operation)) {
    const tables = emptyTableSet();
    collectModelTables(model, writeDataOf(args), tables);
    if (DELETE_OPERATIONS.has(operation)) tables.untracked = true;
    return { reads: null, writes: tables };
  }
  const tables = emptyTableSet();
  collectModelTables(model, args, tables);
  // Unknown model operation (a future Prisma API): count it as both, conservatively.
  return { reads: tables, writes: { tables: new Set(tables.tables), untracked: tables.untracked } };
}

/**
 * Body of the Prisma query extension: records the operation in the active scope, runs it, and
 * reports a successful write that no DatabaseService write scope will invalidate.
 */
export async function trackPrismaOperation<T>(
  model: string | undefined,
  operation: string,
  args: PrismaArgValue,
  run: (args: PrismaArgValue) => Promise<T>
): Promise<T> {
  const scope = openScope(storage.getStore());
  // Hot path: a read outside any scope has nobody to report to, so skip the argument walk.
  if (!scope && isReadOnlyOperation(model, operation, args)) return run(args);

  const effect = describeOperation(model, operation, args);
  let writeIsScoped = false;
  for (let current = scope; current; current = openScope(current.parent)) {
    if (effect.reads) mergeTableSet(current.read, effect.reads);
    if (current.kind === 'write') {
      writeIsScoped = true;
      if (effect.writes) mergeTableSet(current.written, effect.writes);
    }
  }

  const result = await run(args);

  if (effect.writes && !writeIsScoped) reportUntrackedWrite(effect.writes);
  return result;
}

function reportUntrackedWrite(writes: TableSet): void {
  if (!untrackedWriteListener) return;
  try {
    untrackedWriteListener(writes);
  } catch {
    // The registered listener (DatabaseService) logs its own failures; this only guarantees
    // that cache invalidation can never fail a write that already committed.
  }
}

/** Prisma client extension definition; PrismaService passes it to `$extends`. */
export const queryTrackingExtension = {
  name: 'hcb-query-dependency-tracking',
  query: {
    async $allOperations({
      model,
      operation,
      args,
      query,
    }: {
      model?: string;
      operation: string;
      args: PrismaArgValue;
      query: (args: PrismaArgValue) => Promise<PrismaArgValue>;
    }): Promise<PrismaArgValue> {
      return trackPrismaOperation(model, operation, args, query);
    },
  },
} as const;
