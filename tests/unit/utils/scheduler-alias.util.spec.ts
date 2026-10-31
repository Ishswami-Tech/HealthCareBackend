import { describe, expect, it } from '@jest/globals';
import { findDuplicateSchedulers, scheduledMethodNames } from '@utils/scheduler-alias.util';

/** Stand-in for Reflect metadata: methods named `cron*` are "scheduled". */
const SCHEDULED = new WeakSet<object>();
const getMetadata = (fn: unknown): unknown =>
  typeof fn === 'function' && SCHEDULED.has(fn) ? 'CRON' : undefined;

class BaseJobs {
  cronInherited(): void {}
}
class Jobs extends BaseJobs {
  cronTick(): void {}
  helper(): void {}
}
SCHEDULED.add(BaseJobs.prototype.cronInherited);
SCHEDULED.add(Jobs.prototype.cronTick);

class PlainService {
  run(): void {}
}

describe('scheduledMethodNames', () => {
  it('lists own and inherited scheduled methods only', () => {
    expect(scheduledMethodNames(new Jobs(), getMetadata).sort()).toEqual([
      'cronInherited',
      'cronTick',
    ]);
    expect(scheduledMethodNames(new PlainService(), getMetadata)).toEqual([]);
  });
});

describe('findDuplicateSchedulers', () => {
  it('flags a scheduled instance exposed by its class AND a useExisting alias', () => {
    const jobs = new Jobs();
    const duplicates = findDuplicateSchedulers(
      [
        { instance: jobs, isAlias: false },
        { instance: jobs, isAlias: true }, // { provide: 'JOBS', useExisting: Jobs }
      ],
      getMetadata
    );
    expect(duplicates).toEqual([
      { className: 'Jobs', registrations: 2, methods: expect.arrayContaining(['cronTick']) },
    ]);
  });

  it('ignores single registrations and aliased classes without scheduled methods', () => {
    const plain = new PlainService();
    expect(
      findDuplicateSchedulers(
        [
          { instance: new Jobs() },
          { instance: plain },
          { instance: plain, isAlias: true },
          { instance: null },
          { instance: 'not-an-object' },
        ],
        getMetadata
      )
    ).toEqual([]);
  });
});
