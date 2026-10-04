/**
 * Dependent caps for patient self-service must be atomic and cycle-proof.
 *
 * Runs against a stateful fake of the family tables where every insert takes a few
 * milliseconds, so concurrent requests really interleave between "count" and "insert":
 *  - the ACTIVE cap (10) holds under parallel creates (per-patient lock)
 *  - removed dependents still count towards a rolling 30-day creation cap (20)
 */

import { ConflictException, HttpException } from '@nestjs/common';
import {
  DEPENDENT_CREATION_WINDOW_DAYS,
  FamilyMembersService,
  MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
  MAX_DEPENDENT_CREATIONS_PER_WINDOW,
} from '@services/patient-visits/services/family-members.service';
import type { CreateFamilyMemberDto } from '@dtos/family-member.dto';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));

const CLINIC = 'clinic-1';
const ACTOR = { userId: 'user-self', role: 'PATIENT' };
const DAY_MS = 24 * 60 * 60 * 1000;

const DTO: CreateFamilyMemberDto = {
  primaryPatientId: 'patient-self',
  firstName: 'Aarav',
  lastName: 'Bhujbal',
  relation: 'Son',
  gender: 'MALE',
  dateOfBirth: '2018-04-12',
};

const SELF_SERVICE = {
  maxActiveDependents: MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
  maxRecentCreations: MAX_DEPENDENT_CREATIONS_PER_WINDOW,
};

interface StoredMember {
  id: string;
  patientId: string;
  userId: string;
  firstName: string;
  lastName: string;
  relation: string;
  gender: string | null;
  dateOfBirth: Date | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface CountWhere {
  patientId: string;
  isActive?: boolean;
  deletedAt?: null;
  createdAt?: { gte: Date };
}

function wait(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/** Cache fake with real lock semantics (SET NX): a held lock refuses further acquirers. */
function createLockingCache() {
  const held = new Set<string>();
  return {
    held,
    acquireLock: jest.fn(async (key: string): Promise<boolean> => {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    }),
    releaseLock: jest.fn(async (key: string): Promise<boolean> => held.delete(key)),
  };
}

/** A cache that never refuses a lock: no mutual exclusion (control run). */
function createNoLockCache() {
  return {
    held: new Set<string>(),
    acquireLock: jest.fn(async (): Promise<boolean> => true),
    releaseLock: jest.fn(async (): Promise<boolean> => true),
  };
}

function storedMember(index: number, ageDays: number, active: boolean): StoredMember {
  const createdAt = new Date(Date.now() - ageDays * DAY_MS);
  return {
    id: `seed-${index}`,
    patientId: 'patient-self',
    userId: `seed-user-${index}`,
    firstName: 'Seed',
    lastName: 'Member',
    relation: 'Son',
    gender: null,
    dateOfBirth: null,
    phone: null,
    notes: null,
    isActive: active,
    createdAt,
    updatedAt: createdAt,
    deletedAt: active ? null : new Date(createdAt.getTime() + DAY_MS),
  };
}

function seed(count: number, ageDays: number, active: boolean): StoredMember[] {
  return Array.from({ length: count }, (_, index) => storedMember(index, ageDays, active));
}

function createHarness(options: { lock?: boolean; seed?: StoredMember[] } = {}) {
  const rows: StoredMember[] = [...(options.seed ?? [])];
  let sequence = rows.length;

  const matches = (row: StoredMember, where: CountWhere): boolean =>
    row.patientId === where.patientId &&
    (where.isActive === undefined || row.isActive === where.isActive) &&
    (where.deletedAt === undefined || row.deletedAt === where.deletedAt) &&
    (where.createdAt === undefined || row.createdAt >= where.createdAt.gte);

  const client = {
    user: {
      create: jest.fn(async () => {
        sequence += 1;
        return { id: `user-${sequence}` };
      }),
    },
    patient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'patient-self' }),
      create: jest.fn(async () => ({ id: `patient-${sequence}` })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    familyMember: {
      count: jest.fn(async ({ where }: { where: CountWhere }) => {
        await wait(1);
        return rows.filter(row => matches(row, where)).length;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        await wait(5);
        const row: StoredMember = {
          id: `fam-${rows.length + 1}`,
          patientId: String(data['patientId']),
          userId: String(data['userId']),
          firstName: String(data['firstName']),
          lastName: String(data['lastName']),
          relation: String(data['relation']),
          gender: null,
          dateOfBirth: null,
          phone: null,
          notes: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        rows.push(row);
        return row;
      }),
      findFirst: jest.fn(
        async ({ where }: { where: { id: string; deletedAt: null } }) =>
          rows.find(row => row.id === where.id && row.deletedAt === null) ?? null
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<StoredMember> }) => {
          const row = rows.find(candidate => candidate.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        }
      ),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    executeHealthcareWrite: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
  };
  const cache = options.lock === false ? createNoLockCache() : createLockingCache();
  const service = new FamilyMembersService(
    databaseService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    { emit: jest.fn().mockResolvedValue(undefined) } as never,
    cache as never
  );
  const activeCount = (): number =>
    rows.filter(row => row.patientId === 'patient-self' && row.isActive && row.deletedAt === null)
      .length;
  return { service, rows, client, cache, activeCount };
}

describe('FamilyMembersService dependent cap is atomic (parallel creates)', () => {
  it('15 parallel self-service creates yield exactly 10 active dependents; the rest get 409', async () => {
    const h = createHarness();

    const outcomes = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
      )
    );

    const created = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
    );
    expect(created).toHaveLength(MAX_ACTIVE_DEPENDENTS_PER_PATIENT);
    expect(rejected).toHaveLength(5);
    expect(rejected.every(outcome => outcome.reason instanceof ConflictException)).toBe(true);
    expect(h.activeCount()).toBe(MAX_ACTIVE_DEPENDENTS_PER_PATIENT);
    // exactly one User + Patient row minted per accepted dependent
    expect(h.client.user.create).toHaveBeenCalledTimes(MAX_ACTIVE_DEPENDENTS_PER_PATIENT);
    expect(h.client.patient.create).toHaveBeenCalledTimes(MAX_ACTIVE_DEPENDENTS_PER_PATIENT);
    expect(h.cache.held.size).toBe(0);
  });

  it('control: the SAME fake without the lock overshoots the cap, so the test does detect the race', async () => {
    const h = createHarness({ lock: false });

    await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
      )
    );

    expect(h.activeCount()).toBeGreaterThan(MAX_ACTIVE_DEPENDENTS_PER_PATIENT);
  });

  it('takes the per-patient lock around count + create and releases it in finally', async () => {
    const h = createHarness();

    await h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE);

    expect(h.cache.acquireLock).toHaveBeenCalledWith(
      'lock:family-members:create:patient-self',
      expect.any(Number)
    );
    expect(h.cache.releaseLock).toHaveBeenCalledWith('lock:family-members:create:patient-self');
    expect(h.cache.held.size).toBe(0);
  });

  it('releases the lock when the cap rejects the request', async () => {
    const h = createHarness({ seed: seed(10, 1, true) });

    await expect(
      h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.cache.held.size).toBe(0);
    expect(h.client.user.create).not.toHaveBeenCalled();
  });

  it('releases the lock when the write itself fails', async () => {
    const h = createHarness();
    h.client.familyMember.create.mockRejectedValueOnce(new Error('insert failed'));

    await expect(h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)).rejects.toThrow(
      'insert failed'
    );

    expect(h.cache.held.size).toBe(0);
  });

  it('staff registrations take no lock and are not capped', async () => {
    const h = createHarness({ seed: seed(12, 1, true) });

    await expect(h.service.createFamilyMember(DTO, CLINIC, ACTOR)).resolves.toMatchObject({
      primaryPatientId: 'patient-self',
    });
    expect(h.cache.acquireLock).not.toHaveBeenCalled();
    expect(h.client.familyMember.count).not.toHaveBeenCalled();
  });

  describe('when the lock cannot be taken', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('fails closed with a 409 after a bounded wait and creates nothing', async () => {
      const h = createHarness();
      h.cache.acquireLock.mockResolvedValue(false);

      const assertion = expect(
        h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
      ).rejects.toThrow('Another family member is being added');
      await jest.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(h.client.user.create).not.toHaveBeenCalled();
      expect(h.cache.releaseLock).not.toHaveBeenCalled();
    });
  });
});

describe('FamilyMembersService rolling 30-day creation cap (soft-deleted rows count)', () => {
  it('is 20 creations per 30 days', () => {
    expect(MAX_DEPENDENT_CREATIONS_PER_WINDOW).toBe(20);
    expect(DEPENDENT_CREATION_WINDOW_DAYS).toBe(30);
  });

  it('rejects with 429 once 20 dependents were created in the window, even if all were removed', async () => {
    const h = createHarness({ seed: seed(20, 5, false) });
    expect(h.activeCount()).toBe(0);

    const failure = await h.service
      .createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect(h.client.user.create).not.toHaveBeenCalled();
    expect(h.cache.held.size).toBe(0);
  });

  it('create/remove cycling is stopped at the 21st creation although the active count stays at 0', async () => {
    const h = createHarness();

    let created = 0;
    let failure: unknown;
    for (let cycle = 0; cycle < 25 && failure === undefined; cycle += 1) {
      try {
        const member = await h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE);
        created += 1;
        await h.service.deleteFamilyMember(member.id, CLINIC, ACTOR);
      } catch (error: unknown) {
        failure = error;
      }
    }

    expect(created).toBe(MAX_DEPENDENT_CREATIONS_PER_WINDOW);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(429);
    expect(h.activeCount()).toBe(0);
    expect(h.client.user.create).toHaveBeenCalledTimes(MAX_DEPENDENT_CREATIONS_PER_WINDOW);
  });

  it('creations older than the window no longer count', async () => {
    const h = createHarness({ seed: seed(25, 40, false) });

    await expect(
      h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
    ).resolves.toMatchObject({ primaryPatientId: 'patient-self' });
  });

  it('the window count has no isActive / deletedAt condition and starts 30 days back', async () => {
    const h = createHarness();
    const before = Date.now();

    await h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE);

    const windowWhere = h.client.familyMember.count.mock.calls
      .map(call => call[0].where)
      .find(where => where.createdAt !== undefined);
    expect(windowWhere).toBeDefined();
    expect(windowWhere).not.toHaveProperty('isActive');
    expect(windowWhere).not.toHaveProperty('deletedAt');
    const start = windowWhere?.createdAt?.gte.getTime() ?? 0;
    expect(Math.abs(before - start - DEPENDENT_CREATION_WINDOW_DAYS * DAY_MS)).toBeLessThan(5000);
  });

  it('the ACTIVE cap (409) is reported before the window cap (429)', async () => {
    const h = createHarness({ seed: seed(10, 1, true) });

    await expect(
      h.service.createFamilyMember(DTO, CLINIC, ACTOR, SELF_SERVICE)
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
