/// <reference types="jest" />
/**
 * A tiny stateful, in-memory stand-in for DatabaseService, shared by the billing specs.
 *
 * It is NOT a spy: rows live in maps, `updateMany` really honours its `where` (equality, not /
 * in / notIn / gt / gte / lt / lte / OR / null) and applies `data` (increment / decrement)
 * atomically, so the real BillingService methods run against genuine compare-and-set semantics.
 * Every delegate call yields to the event loop first, so overlapping deliveries really interleave.
 *
 * Test hooks: `gate(op)` pauses the next call of an operation until released, `failOnce(op)`
 * makes the next call of an operation throw, `loseNextClaimAck` applies the payment-claim write
 * and then re-runs it (what the database retry does after a lost acknowledgement).
 */

export type Row = Record<string, unknown>;
export type ModelName = 'payment' | 'invoice' | 'subscription' | 'appointment' | 'billingPlan';

type Where = Record<string, unknown>;

/**
 * Realm-safe Date check: `structuredClone` (Node's realm) returns Dates that fail `instanceof Date`
 * inside Jest's sandbox, which silently turned every Date equality into "matches".
 */
function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !isDate(value);
}

/** Deep clone that keeps Dates in the sandbox realm. */
export function deepClone<T>(value: T): T {
  if (isDate(value)) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => deepClone(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepClone(item)])
    ) as T;
  }
  return value;
}

function compare(actual: unknown, expected: unknown): number | null {
  if (actual === null || actual === undefined) {
    return null;
  }
  const left = isDate(actual) ? actual.getTime() : Number(actual);
  const right = isDate(expected) ? expected.getTime() : Number(expected);
  return left - right;
}

function matchValue(actual: unknown, condition: unknown): boolean {
  if (isDate(condition)) {
    return isDate(actual) && actual.getTime() === condition.getTime();
  }
  if (isPlainObject(condition)) {
    return Object.entries(condition).every(([operator, expected]) => {
      switch (operator) {
        case 'not':
          return !matchValue(actual, expected);
        case 'in':
          return (expected as unknown[]).includes(actual);
        case 'notIn':
          return !(expected as unknown[]).includes(actual);
        case 'gt': {
          const delta = compare(actual, expected);
          return delta !== null && delta > 0;
        }
        case 'gte': {
          const delta = compare(actual, expected);
          return delta !== null && delta >= 0;
        }
        case 'lt': {
          const delta = compare(actual, expected);
          return delta !== null && delta < 0;
        }
        case 'lte': {
          const delta = compare(actual, expected);
          return delta !== null && delta <= 0;
        }
        default:
          throw new Error(`FakeBillingDb: unsupported where operator ${operator}`);
      }
    });
  }
  const normalizedActual = actual === undefined ? null : actual;
  const normalizedCondition = condition === undefined ? null : condition;
  return normalizedActual === normalizedCondition;
}

export function matchesWhere(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      return (condition as Where[]).some(branch => matchesWhere(row, branch));
    }
    return matchValue(row[key], condition);
  });
}

export class FakeBillingDb {
  readonly tables: Record<ModelName, Map<string, Row>> = {
    payment: new Map(),
    invoice: new Map(),
    subscription: new Map(),
    appointment: new Map(),
    billingPlan: new Map(),
  };
  /** Every delegate / safe-method call, in order ("payment.updateMany", ...). */
  readonly calls: string[] = [];
  loseNextClaimAck = false;

  private clock = 0;
  private readonly gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  private readonly failures = new Map<string, Error[]>();

  // ---- seeding & inspection ----------------------------------------------------------------

  seed(model: ModelName, row: Row): Row {
    const stored: Row = { createdAt: new Date(1_700_000_000_000), ...deepClone(row) };
    stored['updatedAt'] = this.nextTimestamp();
    this.tables[model].set(String(stored['id']), stored);
    return stored;
  }

  row(model: ModelName, id: string): Row {
    const found = this.tables[model].get(id);
    if (!found) {
      throw new Error(`FakeBillingDb: ${model} ${id} does not exist`);
    }
    return found;
  }

  metadata(model: ModelName, id: string): Record<string, unknown> {
    const metadata = this.row(model, id)['metadata'];
    return isPlainObject(metadata) ? metadata : {};
  }

  count(operation: string): number {
    return this.calls.filter(call => call === operation).length;
  }

  // ---- fault / ordering injection ----------------------------------------------------------

  /** Pauses the NEXT call of `operation` until the returned function is called. */
  gate(operation: string): () => void {
    let release: () => void = () => undefined;
    const promise = new Promise<void>(resolve => {
      release = resolve;
    });
    this.gates.set(operation, { promise, release });
    return release;
  }

  failOnce(operation: string, error: Error = new Error(`injected failure in ${operation}`)): void {
    this.failures.set(operation, [...(this.failures.get(operation) ?? []), error]);
  }

  // ---- the DatabaseService surface used by BillingService ----------------------------------

  private nextTimestamp(): Date {
    this.clock += 1;
    return new Date(1_700_000_000_000 + this.clock);
  }

  private async step(operation: string): Promise<void> {
    this.calls.push(operation);
    await new Promise<void>(resolve => setImmediate(resolve));
    const gate = this.gates.get(operation);
    if (gate) {
      this.gates.delete(operation);
      await gate.promise;
    }
    const queued = this.failures.get(operation);
    const failure = queued?.shift();
    if (failure) {
      throw failure;
    }
  }

  private withRelations(model: ModelName, row: Row): Row {
    const copy = deepClone(row);
    if (model === 'subscription') {
      const plan = this.tables.billingPlan.get(String(row['planId']));
      copy['plan'] = plan ? deepClone(plan) : null;
    }
    return copy;
  }

  private delegate(model: ModelName): {
    findUnique: (args: { where: { id: string } }) => Promise<Row | null>;
    findMany: (args: { where?: Where; take?: number }) => Promise<Row[]>;
    updateMany: (args: { where: Where; data: Row }) => Promise<{ count: number }>;
  } {
    return {
      findUnique: async args => {
        await this.step(`${model}.findUnique`);
        const found = this.tables[model].get(args.where.id);
        return found ? this.withRelations(model, found) : null;
      },
      findMany: async args => {
        await this.step(`${model}.findMany`);
        const rows = [...this.tables[model].values()].filter(row =>
          matchesWhere(row, args.where ?? {})
        );
        return rows.slice(0, args.take ?? rows.length).map(row => this.withRelations(model, row));
      },
      updateMany: async args => {
        await this.step(`${model}.updateMany`);
        let count = 0;
        for (const row of this.tables[model].values()) {
          if (!matchesWhere(row, args.where)) {
            continue;
          }
          for (const [key, value] of Object.entries(args.data)) {
            if (isPlainObject(value) && ('increment' in value || 'decrement' in value)) {
              const base = Number(row[key] ?? 0);
              row[key] = base + Number(value['increment'] ?? 0) - Number(value['decrement'] ?? 0);
            } else {
              row[key] = deepClone(value);
            }
          }
          row['updatedAt'] = this.nextTimestamp();
          count += 1;
        }
        return { count };
      },
    };
  }

  private client(): Record<ModelName, ReturnType<FakeBillingDb['delegate']>> {
    return {
      payment: this.delegate('payment'),
      invoice: this.delegate('invoice'),
      subscription: this.delegate('subscription'),
      appointment: this.delegate('appointment'),
      billingPlan: this.delegate('billingPlan'),
    };
  }

  private safeFind(model: ModelName, id: string): Row | null {
    const found = this.tables[model].get(id);
    return found ? this.withRelations(model, found) : null;
  }

  private safeUpdate(model: ModelName, id: string, data: Row): Row {
    const row = this.row(model, id);
    for (const [key, value] of Object.entries(data)) {
      row[key] = deepClone(value);
    }
    row['updatedAt'] = this.nextTimestamp();
    return this.withRelations(model, row);
  }

  /** The mock handed to `createBillingService({ databaseService })`. */
  readonly service = {
    executeHealthcareWrite: jest.fn(
      async (
        operation: (client: unknown) => Promise<unknown>,
        audit: { details?: { reason?: string } } = {}
      ): Promise<unknown> => {
        if (
          this.loseNextClaimAck &&
          audit.details?.reason === 'Payment callback status transition'
        ) {
          this.loseNextClaimAck = false;
          await operation(this.client());
          return operation(this.client());
        }
        return operation(this.client());
      }
    ),
    executeHealthcareRead: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation(this.client())
    ),
    executeInTransaction: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> => {
        const snapshot = new Map<ModelName, Map<string, Row>>(
          (Object.keys(this.tables) as ModelName[]).map(model => [
            model,
            new Map([...this.tables[model]].map(([id, row]) => [id, deepClone(row)])),
          ])
        );
        try {
          return await operation(this.client());
        } catch (error) {
          for (const [model, rows] of snapshot) {
            this.tables[model].clear();
            for (const [id, row] of rows) {
              this.tables[model].set(id, row);
            }
          }
          throw error;
        }
      }
    ),
    invalidateEntityCache: jest.fn().mockResolvedValue(undefined),
    findPaymentByIdSafe: jest.fn(async (id: string) => this.safeFind('payment', id)),
    findPaymentsSafe: jest.fn(async (where: Where) =>
      [...this.tables.payment.values()]
        .filter(row => matchesWhere(row, where))
        .map(row => this.withRelations('payment', row))
    ),
    updatePaymentSafe: jest.fn(async (id: string, data: Row) =>
      this.safeUpdate('payment', id, data)
    ),
    findInvoiceByIdSafe: jest.fn(async (id: string) => this.safeFind('invoice', id)),
    findInvoicesSafe: jest.fn(async (where: Where) =>
      [...this.tables.invoice.values()]
        .filter(row => matchesWhere(row, where))
        .map(row => this.withRelations('invoice', row))
    ),
    updateInvoiceSafe: jest.fn(async (id: string, data: Row) =>
      this.safeUpdate('invoice', id, data)
    ),
    findSubscriptionByIdSafe: jest.fn(async (id: string) => this.safeFind('subscription', id)),
    findSubscriptionsSafe: jest.fn(async (where: Where) =>
      [...this.tables.subscription.values()]
        .filter(row => matchesWhere(row, where))
        .map(row => this.withRelations('subscription', row))
    ),
    updateSubscriptionSafe: jest.fn(async (id: string, data: Row) =>
      this.safeUpdate('subscription', id, data)
    ),
    findAppointmentByIdSafe: jest.fn(async (id: string) => this.safeFind('appointment', id)),
    findBillingPlanByIdSafe: jest.fn(async (id: string) => this.safeFind('billingPlan', id)),
  };
}
