/// <reference types="jest" />

/**
 * In-memory `healthLibraryPost` delegate with REAL compare-and-set semantics.
 *
 * `updateMany`/`findFirst` evaluate the full Prisma `where` (equality, `null` as
 * IS NULL, Date equality, `not`, `in`, `equals`) against the stored rows, and the
 * match + write of one `updateMany` happens synchronously, i.e. atomically.
 * Every delegate call first yields to the event loop, so two overlapping service
 * calls (Promise.all) genuinely interleave their reads and writes — the shape of
 * a real race. Unsupported operators throw instead of silently matching.
 */

import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import type {
  HealthLibraryPostDelegate,
  HealthLibraryPostRow,
} from '@services/health-library/health-library.types';

type FieldValue = string | number | boolean | Date | null | undefined | object;
type RowRecord = Record<string, FieldValue>;
type WhereCondition = PrismaDelegateArgs[string];

export interface PostStore {
  delegate: HealthLibraryPostDelegate;
  /** Copy of the stored row, or undefined when there is no such row. */
  get: (id: string) => HealthLibraryPostRow | undefined;
  /** Out-of-band change by "another writer" (bypasses `where`; no updatedAt bump). */
  mutate: (id: string, patch: Partial<HealthLibraryPostRow>) => void;
  /** Status after every successful write that changed it, in commit order. */
  statusHistory: () => string[];
}

export interface PostStoreOptions {
  /** Clock used for the automatic `updatedAt` bump (Prisma `@updatedAt`). */
  now?: () => Date;
}

const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function asRecord(row: HealthLibraryPostRow): RowRecord {
  return row as unknown as RowRecord;
}

function isPlainObject(value: WhereCondition | FieldValue): value is Record<string, FieldValue> {
  return typeof value === 'object' && value !== null && !(value instanceof Date);
}

function sameValue(actual: FieldValue, expected: FieldValue): boolean {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

function matchesCondition(actual: FieldValue, condition: WhereCondition): boolean {
  if (!isPlainObject(condition)) {
    return sameValue(actual, condition);
  }
  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case 'equals':
        return sameValue(actual, operand);
      case 'not':
        return !sameValue(actual, operand);
      case 'in':
        return Array.isArray(operand) && operand.some(item => sameValue(actual, item));
      default:
        throw new Error(`fake store: unsupported where operator "${operator}"`);
    }
  });
}

function matchesWhere(row: HealthLibraryPostRow, where: PrismaDelegateArgs | undefined): boolean {
  const record = asRecord(row);
  return Object.entries(where ?? {}).every(([field, condition]) => {
    if (field === 'OR' || field === 'AND' || field === 'NOT') {
      throw new Error(`fake store: unsupported where clause "${field}"`);
    }
    return matchesCondition(record[field], condition);
  });
}

function applyData(
  row: HealthLibraryPostRow,
  data: PrismaDelegateArgs,
  now: Date
): HealthLibraryPostRow {
  const next: RowRecord = { ...asRecord(row) };
  for (const [field, value] of Object.entries(data)) {
    if (isPlainObject(value) && 'increment' in value) {
      const current = next[field];
      const step = value['increment'];
      if (typeof current !== 'number' || typeof step !== 'number') {
        throw new Error(`fake store: cannot increment "${field}"`);
      }
      next[field] = current + step;
    } else {
      next[field] = value;
    }
  }
  // Prisma's @updatedAt: bumped on every write unless the caller sets it.
  if (!('updatedAt' in data)) {
    next['updatedAt'] = now;
  }
  return next as unknown as HealthLibraryPostRow;
}

function copyRow(row: HealthLibraryPostRow): HealthLibraryPostRow {
  const { author, ...rest } = row;
  return {
    ...rest,
    sections: row.sections ? row.sections.map(section => ({ ...section })) : null,
    ...(author !== undefined ? { author: author ? { ...author } : null } : {}),
  };
}

export function createPostStore(
  initialRows: readonly HealthLibraryPostRow[],
  options: PostStoreOptions = {}
): PostStore {
  const now = options.now ?? ((): Date => new Date());
  let rows = new Map<string, HealthLibraryPostRow>(
    initialRows.map(row => [row.id, copyRow(row)] as const)
  );
  const statuses: string[] = [];

  const delegate: HealthLibraryPostDelegate = {
    findFirst: async args => {
      await yieldToEventLoop();
      const found = [...rows.values()].find(row =>
        matchesWhere(row, args['where'] as PrismaDelegateArgs | undefined)
      );
      return found ? copyRow(found) : null;
    },
    findMany: async args => {
      await yieldToEventLoop();
      return [...rows.values()]
        .filter(row => matchesWhere(row, args['where'] as PrismaDelegateArgs | undefined))
        .map(copyRow);
    },
    count: async args => {
      await yieldToEventLoop();
      return [...rows.values()].filter(row =>
        matchesWhere(row, args['where'] as PrismaDelegateArgs | undefined)
      ).length;
    },
    updateMany: async args => {
      await yieldToEventLoop();
      // From here to the return there is no await: match + write is atomic.
      const where = args['where'] as PrismaDelegateArgs | undefined;
      const data = args['data'] as PrismaDelegateArgs;
      const matched = [...rows.values()].filter(row => matchesWhere(row, where));
      const updated = new Map(rows);
      for (const row of matched) {
        const next = applyData(row, data, now());
        updated.set(row.id, next);
        if (next.status !== row.status) {
          statuses.push(next.status);
        }
      }
      rows = updated;
      return { count: matched.length };
    },
    create: () => Promise.reject(new Error('fake store: create is not supported')),
    update: () => Promise.reject(new Error('fake store: update is not supported')),
  };

  return {
    delegate,
    get: id => {
      const row = rows.get(id);
      return row ? copyRow(row) : undefined;
    },
    mutate: (id, patch) => {
      const row = rows.get(id);
      if (!row) {
        throw new Error(`fake store: no row ${id}`);
      }
      rows = new Map(rows).set(id, { ...row, ...patch });
    },
    statusHistory: () => [...statuses],
  };
}
