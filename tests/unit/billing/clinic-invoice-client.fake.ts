/**
 * In-memory `invoice` delegate for the clinic invoice list (findMany / count / groupBy) with the
 * `where` shapes BillingService builds: clinicId, the pharmacist OR scope, status, AND lists.
 */
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'AND') return (condition as Where[]).every(part => matches(row, part));
    if (key === 'OR') return (condition as Where[]).some(part => matches(row, part));
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const ops = condition as Record<string, unknown>;
      if ('not' in ops) return value !== undefined && value !== ops['not'];
      if ('in' in ops) return (ops['in'] as unknown[]).includes(value);
      return true;
    }
    return value === condition;
  });
}

export function clinicInvoiceDelegate(rows: readonly Row[]) {
  return {
    findMany: jest.fn(async (args: { where?: Where; skip?: number; take?: number }) => {
      const found = rows.filter(row => matches(row, args.where));
      const start = args.skip ?? 0;
      return found.slice(start, args.take === undefined ? undefined : start + args.take);
    }),
    count: jest.fn(
      async (args: { where?: Where }) => rows.filter(row => matches(row, args.where)).length
    ),
    groupBy: jest.fn(async (args: { where?: Where }) => {
      const counts = new Map<unknown, number>();
      for (const row of rows.filter(r => matches(r, args.where))) {
        counts.set(row['status'], (counts.get(row['status']) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, all]) => ({ status, _count: { _all: all } }));
    }),
  };
}
