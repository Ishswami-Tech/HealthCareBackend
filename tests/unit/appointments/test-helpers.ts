/**
 * Shared fixtures for the appointment security / check-in unit specs.
 *
 * `FakeDb` is a tiny in-memory stand-in for DatabaseService: just enough Prisma delegate
 * behaviour (where matching incl. null / in / notIn / not / gte / lte / OR, updateMany counts,
 * a rolling-back transaction) for the authorization and check-in rules to run for real.
 */
import { jest } from '@jest/globals';
import { HealthcareErrorsService } from '@core/errors';

export type Row = Record<string, unknown>;

type TableName =
  | 'appointment'
  | 'checkIn'
  | 'checkInLocation'
  | 'patient'
  | 'familyMember'
  | 'receptionist'
  | 'clinicLocation'
  | 'payment'
  | 'videoConsultation';

const TABLES: readonly TableName[] = [
  'appointment',
  'checkIn',
  'checkInLocation',
  'patient',
  'familyMember',
  'receptionist',
  'clinicLocation',
  'payment',
  'videoConsultation',
];

function isPlainObject(value: unknown): value is Row {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function matchesCondition(actual: unknown, condition: unknown): boolean {
  if (condition === null) {
    return actual === null || actual === undefined;
  }
  if (isPlainObject(condition)) {
    if ('in' in condition) {
      return (condition['in'] as unknown[]).includes(actual);
    }
    if ('notIn' in condition) {
      return !(condition['notIn'] as unknown[]).includes(actual);
    }
    if ('not' in condition) {
      return actual !== condition['not'];
    }
    if ('gte' in condition || 'lte' in condition) {
      const value = actual instanceof Date ? actual.getTime() : Number(actual);
      const gte = condition['gte'] instanceof Date ? condition['gte'].getTime() : undefined;
      const lte = condition['lte'] instanceof Date ? condition['lte'].getTime() : undefined;
      return (gte === undefined || value >= gte) && (lte === undefined || value <= lte);
    }
    if ('equals' in condition) {
      return String(actual).toLowerCase() === String(condition['equals']).toLowerCase();
    }
    return false;
  }
  if (condition instanceof Date && actual instanceof Date) {
    return condition.getTime() === actual.getTime();
  }
  return actual === condition;
}

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) {
      return true;
    }
    if (key === 'OR') {
      return (condition as Row[]).some(branch => matchesWhere(row, branch));
    }
    return matchesCondition(row[key], condition);
  });
}

export class FakeDb {
  tables: Record<TableName, Row[]> = {
    appointment: [],
    checkIn: [],
    checkInLocation: [],
    patient: [],
    familyMember: [],
    receptionist: [],
    clinicLocation: [],
    payment: [],
    videoConsultation: [],
  };

  /** Arguments of every findMany, in order (to assert how a query was bounded). */
  findManyCalls: Array<{ table: TableName; args: Row }> = [];

  /** Every create / update / updateMany that ran, in order. */
  writes: Array<{ table: TableName; op: string; args: Row }> = [];

  private idCounter = 0;

  /** Make the next create() on a table throw (to prove the transaction rolls back). */
  failNextCreateOn: TableName | null = null;

  readonly client = this.buildClient();

  executeHealthcareRead = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation(this.client)
  );

  executeRead = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
    operation(this.client)
  );

  executeHealthcareWrite = jest.fn(
    async (operation: (client: unknown) => Promise<unknown>, _audit?: unknown) =>
      operation(this.client)
  );

  /** Transactions run one at a time, like conflicting row locks in a real database. */
  private transactionTail: Promise<unknown> = Promise.resolve();

  executeInTransaction = jest.fn((operation: (client: unknown) => Promise<unknown>) => {
    const run = async (): Promise<unknown> => {
      const snapshot = this.snapshot();
      const writesBefore = this.writes.length;
      try {
        return await operation(this.client);
      } catch (error) {
        this.restore(snapshot);
        this.writes.length = writesBefore;
        throw error;
      }
    };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.catch(() => undefined);
    return result;
  });

  findSubscriptionByIdSafe = jest.fn(async (_id: string): Promise<Row | null> => null);

  findAppointmentByIdSafe = jest.fn(
    async (id: string): Promise<Row | null> =>
      this.tables.appointment.find(row => row['id'] === id) ?? null
  );

  updateAppointmentSafe = jest.fn(async (id: string, data: Row): Promise<Row> => {
    const target = this.tables.appointment.find(row => row['id'] === id);
    if (!target) {
      throw new Error('appointment not found');
    }
    this.writes.push({ table: 'appointment', op: 'updateAppointmentSafe', args: { id, data } });
    Object.assign(target, data);
    return target;
  });

  findPaymentsSafe = jest.fn(async (_where: Row): Promise<Row[]> => []);

  insert(table: TableName, row: Row): Row {
    const stored: Row = { id: `${table}-${++this.idCounter}`, ...row };
    this.tables[table].push(stored);
    return stored;
  }

  rows(table: TableName): Row[] {
    return this.tables[table];
  }

  private snapshot(): Record<TableName, Row[]> {
    const copy = {} as Record<TableName, Row[]>;
    for (const table of TABLES) {
      copy[table] = this.tables[table].map(row => ({ ...row }));
    }
    return copy;
  }

  private restore(snapshot: Record<TableName, Row[]>): void {
    this.tables = snapshot;
  }

  private buildClient(): Record<TableName, Record<string, unknown>> {
    const client = {} as Record<TableName, Record<string, unknown>>;
    for (const table of TABLES) {
      const find = (args?: { where?: Row }): Row | null =>
        this.tables[table].find(row => matchesWhere(row, args?.where)) ?? null;
      client[table] = {
        findFirst: async (args?: { where?: Row; orderBy?: unknown }) => find(args),
        findUnique: async (args?: { where?: Row }) => find(args),
        findMany: async (args?: { where?: Row }) => {
          this.findManyCalls.push({ table, args: (args ?? {}) as Row });
          return this.tables[table].filter(row => matchesWhere(row, args?.where));
        },
        count: async (args?: { where?: Row }) =>
          this.tables[table].filter(row => matchesWhere(row, args?.where)).length,
        create: async (args: { data: Row }) => {
          if (this.failNextCreateOn === table) {
            this.failNextCreateOn = null;
            throw new Error(`forced ${table}.create failure`);
          }
          this.writes.push({ table, op: 'create', args: args as Row });
          return this.insert(table, args.data);
        },
        update: async (args: { where: Row; data: Row }) => {
          this.writes.push({ table, op: 'update', args: args as unknown as Row });
          const target = find({ where: args.where });
          if (!target) {
            throw new Error(`${table}.update: record not found`);
          }
          Object.assign(target, args.data);
          return target;
        },
        updateMany: async (args: { where: Row; data: Row }) => {
          this.writes.push({ table, op: 'updateMany', args: args as unknown as Row });
          const targets = this.tables[table].filter(row => matchesWhere(row, args.where));
          targets.forEach(target => Object.assign(target, args.data));
          return { count: targets.length };
        },
      };
    }
    return client;
  }
}

/** Real error factory (real HTTP statuses), with a logging stub. */
export function createErrors(): HealthcareErrorsService {
  return new HealthcareErrorsService({
    log: jest.fn(async (..._args: unknown[]) => undefined),
  } as never);
}

export function createLoggingStub() {
  return { log: jest.fn(async (..._args: unknown[]) => undefined) };
}

/** In-memory lock + cache behaviour matching the CacheService surface the code uses. */
export function createCacheStub() {
  const heldLocks = new Set<string>();
  return {
    cache: jest.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
    getKeyFactory: jest.fn(() => ({
      appointment: (id: string, scope: string) => `healthcare:appointment:${id}:${scope}`,
    })),
    invalidateAppointmentCache: jest.fn(async (..._args: unknown[]) => 0),
    invalidateCacheByTag: jest.fn(async (..._args: unknown[]) => 0),
    get: jest.fn(async (..._args: unknown[]) => null),
    set: jest.fn(async (..._args: unknown[]) => undefined),
    acquireLock: jest.fn(async (key: string, _ttl: number) => {
      if (heldLocks.has(key)) {
        return false;
      }
      heldLocks.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string) => heldLocks.delete(key)),
    heldLocks,
  };
}
