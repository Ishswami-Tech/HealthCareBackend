import { describe, expect, it } from '@jest/globals';
import {
  SingleFlight,
  cloneForFollower,
} from '../../../src/libs/infrastructure/cache/utils/single-flight.util';
import {
  expandRegistrationTags,
  scopeInvalidationTags,
} from '../../../src/libs/infrastructure/cache/utils/tag-scope.util';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('runs the loader once for concurrent callers of the same key', async () => {
    const flight = new SingleFlight();
    const gate = deferred<string>();
    let calls = 0;
    const loader = (): Promise<string> => {
      calls += 1;
      return gate.promise;
    };

    const all = Promise.all([
      flight.run('k', loader),
      flight.run('k', loader),
      flight.run('k', loader),
    ]);
    expect(flight.has('k')).toBe(true);
    gate.resolve('value');

    await expect(all).resolves.toEqual(['value', 'value', 'value']);
    expect(calls).toBe(1);
    expect(flight.size).toBe(0);
  });

  it('does not coalesce different keys', async () => {
    const flight = new SingleFlight();
    let calls = 0;
    const loader = async (): Promise<number> => ++calls;

    await Promise.all([flight.run('a', loader), flight.run('b', loader)]);

    expect(calls).toBe(2);
  });

  it('shares a rejection with every waiter and never caches it', async () => {
    const flight = new SingleFlight();
    const gate = deferred<string>();

    const first = flight.run('k', () => gate.promise);
    const second = flight.run('k', () => Promise.resolve('unused'));
    gate.reject(new Error('db down'));

    await expect(first).rejects.toThrow('db down');
    await expect(second).rejects.toThrow('db down');
    expect(flight.has('k')).toBe(false);
    await expect(flight.run('k', () => Promise.resolve('fresh'))).resolves.toBe('fresh');
  });

  it('starts a new load once the previous one settled', async () => {
    const flight = new SingleFlight();
    let calls = 0;
    const loader = async (): Promise<number> => ++calls;

    await flight.run('k', loader);
    await flight.run('k', loader);

    expect(calls).toBe(2);
  });

  it('gives followers a deep copy so one response cannot mutate another', () => {
    const original = { items: [{ id: 1 }] };
    const copy = cloneForFollower(original);

    copy.items[0]!.id = 2;

    expect(original.items[0]!.id).toBe(1);
    expect(cloneForFollower('text')).toBe('text');
  });
});

describe('clinic-scoped collection tags', () => {
  const CLINIC_A = 'clinic-a';

  it('indexes collection tags under the clinic as well as globally', () => {
    expect(expandRegistrationTags(['appointments', 'appointment:1'], CLINIC_A)).toEqual([
      'appointments',
      `clinic:${CLINIC_A}:appointments`,
      'appointment:1',
    ]);
  });

  it('derives the clinic from a clinic:<id> tag, else marks the entry clinic-less', () => {
    expect(expandRegistrationTags(['users', `clinic:${CLINIC_A}`])).toContain(
      `clinic:${CLINIC_A}:users`
    );
    expect(expandRegistrationTags(['users'])).toEqual(['users', 'noclinic:users']);
  });

  it("a clinic's write invalidates only its own lists plus clinic-less entries", () => {
    expect(scopeInvalidationTags(['appointments', 'user:9'], CLINIC_A)).toEqual([
      `clinic:${CLINIC_A}:appointments`,
      'noclinic:appointments',
      'user:9',
    ]);
  });

  it('a write without a clinic stays global', () => {
    expect(scopeInvalidationTags(['appointments'], undefined)).toEqual(['appointments']);
  });
});
