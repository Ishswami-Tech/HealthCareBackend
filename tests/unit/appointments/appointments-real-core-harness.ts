/**
 * An AppointmentsService wired to the REAL CoreAppointmentService on top of an in-memory database,
 * so the generic update, the booking / reschedule slot rule and the expiry crons run their real
 * logic end to end. Import it only from specs that register the usual jest.mock() header first.
 */
import { jest } from '@jest/globals';
import { CoreAppointmentService } from '@services/appointments/core/core-appointment.service';
import { AppointmentWorkflowEngine } from '@services/appointments/core/appointment-workflow-engine.service';
import { FakeDb, type Row } from './test-helpers';
import { buildHarness } from './appointments-harness';

type Predicate = (row: Row) => boolean;

function valueOf(value: unknown): number | string {
  return value instanceof Date ? value.getTime() : (value as number | string);
}

/** The slice of Prisma `where` the paged candidate queries use (adds gt / lt / not / in to FakeDb). */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) {
    return true;
  }
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) {
      return true;
    }
    if (key === 'OR') {
      return (condition as Row[]).some(branch => matches(row, branch));
    }
    const actual = row[key];
    if (condition === null) {
      return actual === null || actual === undefined;
    }
    if (condition instanceof Date) {
      return valueOf(actual) === condition.getTime();
    }
    if (typeof condition === 'object') {
      const operators = condition as Row;
      const checks: Predicate[] = [];
      if ('in' in operators) {
        checks.push(() => (operators['in'] as unknown[]).includes(actual));
      }
      if ('notIn' in operators) {
        checks.push(() => !(operators['notIn'] as unknown[]).includes(actual));
      }
      if ('not' in operators) {
        checks.push(() => actual !== operators['not']);
      }
      if ('gt' in operators) {
        checks.push(() => valueOf(actual) > valueOf(operators['gt']));
      }
      if ('gte' in operators) {
        checks.push(() => valueOf(actual) >= valueOf(operators['gte']));
      }
      if ('lt' in operators) {
        checks.push(() => valueOf(actual) < valueOf(operators['lt']));
      }
      if ('lte' in operators) {
        checks.push(() => valueOf(actual) <= valueOf(operators['lte']));
      }
      return checks.every(check => check(row));
    }
    return actual === condition;
  });
}

function compare(left: Row, right: Row, orderBy: Row[]): number {
  for (const order of orderBy) {
    const [field, direction] = Object.entries(order)[0] ?? ['id', 'asc'];
    const a = valueOf(left[field]);
    const b = valueOf(right[field]);
    if (a < b) {
      return direction === 'asc' ? -1 : 1;
    }
    if (a > b) {
      return direction === 'asc' ? 1 : -1;
    }
  }
  return 0;
}

/**
 * FakeDb whose appointment.findMany honours the full where, orderBy and take (the expiry crons
 * page through it), plus the doctor and clinic lookups the booking path reads.
 */
export class PagedFakeDb extends FakeDb {
  /** Every findMany issued on the appointment table, to assert how the scan paged. */
  appointmentQueries: Row[] = [];

  constructor() {
    super();
    const base = this.client;
    const paged = {
      ...base,
      appointment: {
        ...base['appointment'],
        findFirst: async (args?: { where?: Row }) =>
          this.rows('appointment').find(row => matches(row, args?.where)) ?? null,
        findMany: async (args?: { where?: Row; orderBy?: Row | Row[]; take?: number }) => {
          this.appointmentQueries.push((args ?? {}) as Row);
          const orderBy = args?.orderBy ? ([] as Row[]).concat(args.orderBy) : [];
          const rows = this.rows('appointment').filter(row => matches(row, args?.where));
          rows.sort((left, right) => compare(left, right, orderBy));
          return args?.take === undefined ? rows : rows.slice(0, args.take);
        },
      },
      doctor: {
        findFirst: async () => ({ id: 'doctor-1', userId: 'user-doctor' }),
      },
      clinic: {
        findUnique: async () => ({ settings: {} }),
      },
    };
    this.executeHealthcareRead = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation(paged)
    );
    this.executeRead = jest.fn(async (operation: (client: unknown) => Promise<unknown>) =>
      operation(paged)
    );
  }

  findAppointmentsSafe = jest.fn(async (where: Row, _options?: unknown): Promise<Row[]> =>
    this.rows('appointment').filter(row => matches(row, where))
  );

  createAppointmentSafe = jest.fn(async (data: Row): Promise<Row> => {
    return this.insert('appointment', { id: 'appt-new', ...data });
  });
}

export function buildRealCoreHarness() {
  const db = new PagedFakeDb();
  const base = buildHarness({ db });

  Object.assign(base.cache, {
    delPattern: jest.fn(async (..._args: unknown[]) => 0),
    invalidateMyAppointmentsCache: jest.fn(async (..._args: unknown[]) => 0),
    invalidateUpcomingAppointmentsCache: jest.fn(async (..._args: unknown[]) => 0),
    invalidateDoctorCache: jest.fn(async (..._args: unknown[]) => 0),
    del: jest.fn(async (..._args: unknown[]) => 0),
  });

  const config = { getEnv: jest.fn((_key: string, fallback: string) => fallback) };
  const jobs = { addJob: jest.fn(async (..._args: unknown[]) => undefined) };
  const businessRules = {
    validateAppointmentCreation: jest.fn(async (..._args: unknown[]) => ({
      passed: true,
      violations: [],
    })),
  };

  const realCore = new CoreAppointmentService(
    db as never,
    base.logging as never,
    base.cache as never,
    jobs as never,
    base.events as never,
    config as never,
    base.errors as never,
    {} as never, // conflictResolutionService: no longer consulted by the booking path
    new AppointmentWorkflowEngine(),
    businessRules as never
  );

  // The service holds its core as a private field; the harness gave it a mock.
  Object.assign(base.service, { coreAppointmentService: realCore });

  return { ...base, db, realCore, jobs, businessRules };
}

export type RealCoreHarness = ReturnType<typeof buildRealCoreHarness>;
