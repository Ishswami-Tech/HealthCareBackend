/**
 * The arrival is committed in the database but the doctor's live queue is not part of that
 * transaction. A failed queue push must therefore (a) answer 503, never success, (b) leave no
 * stale cache behind, and (c) be repaired by simply retrying. Also: what check-in writes to the
 * live queue is what the queue reads (and the patient's own lookup) find again.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { AppointmentQueueService } from '@infrastructure/queue';
import { QueueController } from '@infrastructure/queue/src/controllers/queue.controller';
import { formatDateKeyInIST } from '@utils/date-time.util';
import type { ProcessCheckInOptions } from '@core/types/appointment.types';
import {
  CLINIC,
  PATIENT_ACTOR,
  RECEPTIONIST_ACTOR,
  buildCheckInServiceWorld,
  checkInInput,
  inPersonRow,
} from './check-in-service-world';
import { FakeQueueCache } from './fake-queue-cache';
import { pinClock, unpinClock } from './check-in-time-helpers';

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

const scan: ProcessCheckInOptions = { actor: PATIENT_ACTOR, presence: 'if-supplied' };
const desk: ProcessCheckInOptions = { actor: RECEPTIONIST_ACTOR, presence: 'skip' };

describe('queue push failure after the arrival is committed (stub queue)', () => {
  let cache: FakeQueueCache;
  let w: ReturnType<typeof buildCheckInServiceWorld<FakeQueueCache>>;

  beforeEach(() => {
    pinClock();
    cache = new FakeQueueCache();
    w = buildCheckInServiceWorld({ cache });
    w.db.insert('appointment', inPersonRow());
  });

  afterEach(() => {
    unpinClock();
  });

  const checkIn = (options: ProcessCheckInOptions = scan) =>
    w.service.processCheckIn(checkInInput(), CLINIC, options);

  function expectCommittedButNotQueued(): void {
    expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');
    expect(w.db.rows('appointment')[0]?.['checkedInAt']).toBeInstanceOf(Date);
    expect(w.db.rows('checkIn')).toHaveLength(1);
    expect(w.queued.size).toBe(0);
  }

  it('the queue throwing is a 503, and a retry re-adds the entry (alreadyCheckedIn + queueRepaired)', async () => {
    w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

    const error = await rejection(checkIn());
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expectCommittedButNotQueued();

    const retry = await checkIn();

    expect(retry.alreadyCheckedIn).toBe(true);
    expect(retry.queueRepaired).toBe(true);
    expect(w.queued.size).toBe(1);
    expect(w.db.rows('checkIn')).toHaveLength(1);
  });

  it('the queue lock NOT being acquired is a 503, never a success (cache unavailable)', async () => {
    cache.lockUnavailable = true;

    const error = await rejection(checkIn());

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(w.queue.checkIn).not.toHaveBeenCalled();
    expectCommittedButNotQueued();
    // Waited a bounded number of times rather than giving up at once or forever.
    expect(cache.acquireLock.mock.calls.length).toBeGreaterThan(1);
    expect(cache.acquireLock.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('a cache provider that throws on acquireLock is also a 503', async () => {
    cache.lockThrows = true;

    const error = await rejection(checkIn());

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(w.queue.checkIn).not.toHaveBeenCalled();
  });

  it('retrying once the cache is back repairs the queue', async () => {
    cache.lockUnavailable = true;
    await rejection(checkIn());

    cache.lockUnavailable = false;
    const retry = await checkIn();

    expect(retry.alreadyCheckedIn).toBe(true);
    expect(retry.queueRepaired).toBe(true);
    expect(w.queued.size).toBe(1);
  });

  it('invalidates the appointment and patient caches on the 503 path (finally), not only on success', async () => {
    w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

    await rejection(checkIn());

    expect(cache.invalidateCacheByTag).toHaveBeenCalledWith('appointment:appt-1');
    expect(cache.invalidateCacheByTag).toHaveBeenCalledWith('patient:patient-1');
  });

  it('a failing cache invalidation does not replace the 503 or fail a success', async () => {
    cache.invalidateCacheByTag.mockRejectedValue(new Error('cache down'));
    w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));

    const error = await rejection(checkIn());
    expect(error).toBeInstanceOf(ServiceUnavailableException);

    const retry = await checkIn();
    expect(retry.alreadyCheckedIn).toBe(true);
    expect(w.queued.size).toBe(1);
  });

  it('a retry that finds the entry already queued changes nothing (no repair, no second entry)', async () => {
    await checkIn();
    w.queue.checkIn.mockClear();
    cache.invalidateCacheByTag.mockClear();

    const again = await checkIn();

    expect(again.alreadyCheckedIn).toBe(true);
    expect(again.queueRepaired).toBe(false);
    expect(w.queued.size).toBe(1);
    expect(w.queue.checkIn).toHaveBeenCalledTimes(1); // the membership check itself
    expect(cache.invalidateCacheByTag).not.toHaveBeenCalled();
  });

  it('a repair attempt that fails again is a 503 again and invalidates the caches again', async () => {
    w.queue.checkIn.mockRejectedValue(new Error('queue backend unavailable'));
    await rejection(checkIn());
    cache.invalidateCacheByTag.mockClear();

    const error = await rejection(checkIn(desk));

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(cache.invalidateCacheByTag).toHaveBeenCalledWith('appointment:appt-1');
  });

  it('releases the queue lock after a success and after a failure', async () => {
    w.queue.checkIn.mockRejectedValueOnce(new Error('queue backend unavailable'));
    await rejection(checkIn());
    expect(cache.locks.size).toBe(0);

    await checkIn();
    expect(cache.locks.size).toBe(0);
  });

  it('a double click while the first request is still pushing waits for the lock and both succeed with one entry', async () => {
    w.queue.checkIn.mockImplementation(async (entry: { appointmentId: string }) => {
      await new Promise<void>(resolve => setTimeout(resolve, 80));
      if (w.queued.has(entry.appointmentId)) {
        throw new Error('Appointment arrival is already confirmed');
      }
      w.queued.add(entry.appointmentId);
      return { success: true };
    });

    const [first, second] = await Promise.all([checkIn(), checkIn()]);

    expect(
      [first.alreadyCheckedIn === true, second.alreadyCheckedIn === true].filter(Boolean)
    ).toHaveLength(1);
    expect(w.queued.size).toBe(1);
    expect(w.db.rows('checkIn')).toHaveLength(1);
  });

  it('a double click where the first push FAILS is repaired by the second request', async () => {
    let calls = 0;
    w.queue.checkIn.mockImplementation(async (entry: { appointmentId: string }) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>(resolve => setTimeout(resolve, 80));
        throw new Error('queue backend unavailable');
      }
      w.queued.add(entry.appointmentId);
      return { success: true };
    });

    const results = await Promise.allSettled([checkIn(), checkIn()]);

    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ServiceUnavailableException
    );
    expect(w.queued.size).toBe(1);
  });
});

describe('with the real AppointmentQueueService', () => {
  let cache: FakeQueueCache;
  let queueService: AppointmentQueueService;
  let w: ReturnType<typeof buildCheckInServiceWorld<FakeQueueCache>>;
  let today: string;

  beforeEach(() => {
    pinClock();
    today = formatDateKeyInIST(new Date());
    cache = new FakeQueueCache();
    const logging = { log: jest.fn(async (..._args: unknown[]) => undefined) };
    queueService = new AppointmentQueueService(cache as never, logging as never);
    w = buildCheckInServiceWorld({ cache, queue: queueService });
    w.db.insert('appointment', inPersonRow());
  });

  afterEach(() => {
    unpinClock();
  });

  const queueKey = (doctorId = 'doctor-1'): string => `queue:clinic:${CLINIC}:${doctorId}:${today}`;
  const checkIn = (options: ProcessCheckInOptions = scan) =>
    w.service.processCheckIn(checkInInput(), CLINIC, options);

  it('writes the arrival to the doctor queue list of TODAY (IST) in the clinic', async () => {
    await checkIn();

    expect(cache.queueKeys()).toEqual([queueKey()]);
    const entries = (await cache.lRange(queueKey(), 0, -1)).map(
      entry => JSON.parse(entry) as Record<string, unknown>
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      clinicId: CLINIC,
      status: 'WAITING',
      locationId: 'loc-1',
    });
  });

  it('hands out per-doctor tokens that never shift when earlier patients leave the list', async () => {
    const checkInFor = (appointmentId: string, doctorId = 'doctor-1') =>
      queueService.checkIn(
        {
          appointmentId,
          doctorId,
          patientId: `patient-${appointmentId}`,
          clinicId: CLINIC,
          appointmentType: 'IN_PERSON',
        },
        'clinic'
      );
    const tokenOf = async (doctorId: string, appointmentId: string) => {
      const entries = (await cache.lRange(queueKey(doctorId), 0, -1)).map(
        raw => JSON.parse(raw) as { appointmentId: string; tokenNumber?: number }
      );
      return entries.find(entry => entry.appointmentId === appointmentId)?.tokenNumber;
    };

    await checkInFor('a-1');
    await checkInFor('a-2');
    await checkInFor('b-1', 'doctor-2');
    // the first patient leaves the list; the next arrival must not reuse token 2
    cache.lists.set(queueKey(), (cache.lists.get(queueKey()) ?? []).slice(1));
    await checkInFor('a-3');

    expect(await tokenOf('doctor-1', 'a-1')).toBeUndefined();
    expect(await tokenOf('doctor-1', 'a-2')).toBe(2);
    expect(await tokenOf('doctor-1', 'a-3')).toBe(3);
    expect(await tokenOf('doctor-2', 'b-1')).toBe(1);
  });

  it('the real duplicate error is what the queue throws and what ensureQueued treats as "already queued"', async () => {
    await checkIn();

    // The real service's own answer for an entry that exists...
    await expect(
      queueService.checkIn(
        {
          appointmentId: 'appt-1',
          doctorId: 'doctor-1',
          patientId: 'patient-1',
          clinicId: CLINIC,
          appointmentType: 'IN_PERSON',
        },
        'clinic'
      )
    ).rejects.toThrow('Appointment arrival is already confirmed');

    // ...is a clean success for a repeated check-in: no repair, no 503, still one entry.
    const again = await checkIn();
    expect(again.alreadyCheckedIn).toBe(true);
    expect(again.queueRepaired).toBe(false);
    expect(await cache.lLen(queueKey())).toBe(1);
  });

  it('a push that fails inside the real queue is a 503, and the retry leaves exactly one entry', async () => {
    const rPush = jest.spyOn(cache, 'rPush').mockRejectedValueOnce(new Error('connection reset'));

    const error = await rejection(checkIn());

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(rPush).toHaveBeenCalledTimes(1);
    expect(await cache.lLen(queueKey())).toBe(0);
    expect(w.db.rows('appointment')[0]?.['status']).toBe('CONFIRMED');

    const retry = await checkIn();
    expect(retry.alreadyCheckedIn).toBe(true);
    expect(retry.queueRepaired).toBe(true);
    expect(await cache.lLen(queueKey())).toBe(1);
  });

  it('the clinic queue read finds the entry check-in wrote (GET /queue without doctorId)', async () => {
    await checkIn();

    const clinicQueue = await queueService.getClinicQueue(CLINIC, today, 'clinic');

    expect(clinicQueue).toHaveLength(1);
    expect(clinicQueue[0]).toMatchObject({
      appointmentId: 'appt-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      position: 1,
    });
  });

  describe('through QueueController (GET /queue and GET /queue/me)', () => {
    let controller: QueueController;

    beforeEach(() => {
      const bullQueueService = {
        getSupportedQueueFilters: () => [],
        getQueueFilterCatalog: () => [],
      };
      controller = new QueueController(
        queueService,
        bullQueueService as never,
        {} as never,
        w.db as never
      );
    });

    const request = (role: string, userId: string) =>
      ({ user: { sub: userId, id: userId, role }, clinicContext: { clinicId: CLINIC } }) as never;

    it('GET /queue (no doctorId) lists the arrival for reception', async () => {
      await checkIn();

      const result = await controller.listQueue({}, request('RECEPTIONIST', 'user-reception'));

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ doctorId: 'doctor-1', patientId: 'patient-1' });
    });

    it('GET /queue with a doctorId lists the same arrival', async () => {
      await checkIn();

      const result = await controller.listQueue(
        { doctorId: 'doctor-1' },
        request('DOCTOR', 'user-doctor')
      );

      expect(result.data).toHaveLength(1);
    });

    it("GET /queue/me finds the patient's own entry", async () => {
      await checkIn();

      const result = await controller.getMyQueuePosition(
        undefined,
        request('PATIENT', 'user-patient')
      );

      expect(result.data).not.toBeNull();
      expect(result.data).toMatchObject({ appointmentId: 'appt-1' });
    });

    it('GET /queue/me returns the stable token number assigned at check-in', async () => {
      await checkIn();

      const result = await controller.getMyQueuePosition(
        undefined,
        request('PATIENT', 'user-patient')
      );

      expect(result.data).toMatchObject({ appointmentId: 'appt-1', tokenNumber: 1 });
    });

    it('GET /queue/me gives null for an entry that predates tokens', async () => {
      await checkIn();
      const [raw] = await cache.lRange(queueKey(), 0, -1);
      const { tokenNumber: _drop, ...legacy } = JSON.parse(raw as string) as Record<
        string,
        unknown
      >;
      cache.lists.set(queueKey(), [JSON.stringify(legacy)]);

      const result = await controller.getMyQueuePosition(
        undefined,
        request('PATIENT', 'user-patient')
      );

      expect(result.data).toMatchObject({ tokenNumber: null });
    });

    it('GET /queue/me narrows by appointmentId and does not show another patient the entry', async () => {
      await checkIn();

      const mine = await controller.getMyQueuePosition(
        'appt-1',
        request('PATIENT', 'user-patient')
      );
      const other = await controller.getMyQueuePosition('appt-1', request('PATIENT', 'user-other'));
      const wrongAppointment = await controller.getMyQueuePosition(
        'appt-nope',
        request('PATIENT', 'user-patient')
      );

      expect(mine.data).not.toBeNull();
      expect(other.data).toBeNull();
      expect(wrongAppointment.data).toBeNull();
    });
  });
});

describe('token series: ONE per location per day, location-prefixed, shared by walk-ins', () => {
  let cache: FakeQueueCache;
  let queueService: AppointmentQueueService;
  let today: string;

  beforeEach(() => {
    pinClock();
    today = formatDateKeyInIST(new Date());
    cache = new FakeQueueCache();
    const logging = { log: jest.fn(async (..._args: unknown[]) => undefined) };
    queueService = new AppointmentQueueService(cache as never, logging as never);
  });

  afterEach(() => {
    unpinClock();
  });

  const arrive = (
    appointmentId: string,
    locationId: string,
    extra: { tokenPrefix?: string; isWalkIn?: boolean; priority?: string } = {}
  ) =>
    queueService.checkIn(
      {
        appointmentId,
        doctorId: 'doctor-1',
        patientId: `patient-${appointmentId}`,
        clinicId: CLINIC,
        appointmentType: 'IN_PERSON',
        locationId,
        ...extra,
      },
      'clinic'
    );

  const entries = async () =>
    (await cache.lRange(`queue:clinic:${CLINIC}:doctor-1:${today}`, 0, -1)).map(
      raw =>
        JSON.parse(raw) as {
          appointmentId: string;
          tokenNumber?: number;
          tokenLabel?: string;
          isWalkIn?: boolean;
          priority?: number;
        }
    );

  it('numbers each location on its own counter with its own prefix (K-001.., B-001..)', async () => {
    await arrive('k1', 'loc-kothrud', { tokenPrefix: 'K' });
    await arrive('b1', 'loc-baner', { tokenPrefix: 'B' });
    await arrive('k2', 'loc-kothrud', { tokenPrefix: 'K' });

    const byId = new Map((await entries()).map(entry => [entry.appointmentId, entry]));
    expect(byId.get('k1')).toMatchObject({
      tokenNumber: 1,
      tokenLabel: 'K-001',
    });
    expect(byId.get('b1')).toMatchObject({
      tokenNumber: 1,
      tokenLabel: 'B-001',
    });
    expect(byId.get('k2')).toMatchObject({
      tokenNumber: 2,
      tokenLabel: 'K-002',
    });
    expect([...cache.counters.keys()].sort()).toEqual([
      `queue:token:${CLINIC}:location:loc-baner:${today}`,
      `queue:token:${CLINIC}:location:loc-kothrud:${today}`,
    ]);
  });

  it('walk-ins share the series (tagged), priority is only an ordering flag', async () => {
    await arrive('k1', 'loc-kothrud', { tokenPrefix: 'K' });
    await arrive('w1', 'loc-kothrud', { tokenPrefix: 'K', isWalkIn: true });
    await arrive('s1', 'loc-kothrud', {
      tokenPrefix: 'K',
      priority: 'EMERGENCY',
    });

    const list = await entries();
    expect(list.map(entry => entry.tokenLabel)).toEqual(['K-001', 'K-002', 'K-003']);
    expect(list.find(entry => entry.appointmentId === 'w1')?.isWalkIn).toBe(true);
    expect(list.find(entry => entry.appointmentId === 'k1')?.isWalkIn).toBeUndefined();

    const queue = await queueService.getDoctorQueue(
      'doctor-1',
      CLINIC,
      today,
      'clinic',
      'loc-kothrud'
    );
    // the emergency patient is served first but keeps its own number
    expect(queue.queue.map(entry => entry.tokenLabel)).toEqual(['K-003', 'K-001', 'K-002']);
  });

  it('without a database or cache counter it fails (retryable) instead of guessing a token', async () => {
    // Audit P0-2: the old fallback guessed from one doctor's list and handed out duplicates at
    // a multi-doctor location. No guess: the caller answers 503 and the retry gets a real token.
    await arrive('k1', 'loc-kothrud', { tokenPrefix: 'K' });
    jest.spyOn(cache, 'incr').mockRejectedValueOnce(new Error('down'));
    await expect(arrive('k2', 'loc-kothrud', { tokenPrefix: 'K' })).rejects.toThrow('down');
    jest.spyOn(cache, 'incr').mockResolvedValueOnce(0);
    await expect(arrive('k2', 'loc-kothrud', { tokenPrefix: 'K' })).rejects.toThrow(
      'Token counter unavailable'
    );

    expect((await entries()).map(entry => entry.appointmentId)).toEqual(['k1']);
    await arrive('k2', 'loc-kothrud', { tokenPrefix: 'K' });
    const k2 = (await entries()).find(entry => entry.appointmentId === 'k2');
    expect(k2).toMatchObject({ tokenNumber: 2, tokenLabel: 'K-002' });
  });

  it('a token handed in by the check-in transaction is used as is (no cache counter)', async () => {
    await queueService.checkIn(
      {
        appointmentId: 'k9',
        doctorId: 'doctor-1',
        patientId: 'patient-k9',
        clinicId: CLINIC,
        locationId: 'loc-kothrud',
        tokenNumber: 9,
        tokenLabel: 'K-009',
      },
      'clinic'
    );

    expect((await entries())[0]).toMatchObject({ tokenNumber: 9, tokenLabel: 'K-009' });
    expect(cache.counters.size).toBe(0);
  });

  it('check-in derives the prefix from the stored location name and tags walk-ins', async () => {
    const w = buildCheckInServiceWorld({ cache, queue: queueService });
    const location = w.db.rows('clinicLocation').find(row => row['id'] === 'loc-1');
    if (!location) throw new Error('loc-1');
    location['name'] = 'Baner';
    w.db.insert(
      'appointment',
      inPersonRow({ metadata: { isWalkIn: true, bookingSource: 'WALK_IN' } })
    );

    await w.service.processCheckIn(checkInInput(), CLINIC, desk);

    const [entry] = await entries();
    expect(entry).toMatchObject({
      tokenNumber: 1,
      tokenLabel: 'B-001',
      isWalkIn: true,
    });
  });
});

describe('durable token from the check-in transaction (audit P0-1 / P0-2)', () => {
  let cache: FakeQueueCache;
  let queueService: AppointmentQueueService;
  let w: ReturnType<typeof buildCheckInServiceWorld<FakeQueueCache>>;
  let counters: Map<string, number>;
  let today: string;

  /** The three statements of assignLocationToken against the FakeDb appointment rows. */
  function attachRawSql(): void {
    counters = new Map();
    const rawSql = async (sql: string, ...values: Array<string | number | null>) => {
      const rows = w.db.rows('appointment');
      if (sql.includes('FOR UPDATE')) {
        const row = rows.find(candidate => candidate['id'] === values[0]);
        if (!row) return [];
        return [{ tokenNumber: null, tokenLabel: null, tokenDay: null, ...row }];
      }
      if (sql.includes('location_token_counters')) {
        const key = values.slice(0, 3).join('|');
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return [{ lastValue: next }];
      }
      const row = rows.find(candidate => candidate['id'] === values[0]);
      if (!row || typeof row['tokenNumber'] === 'number') return [];
      Object.assign(row, { tokenNumber: values[1], tokenLabel: values[2], tokenDay: values[3] });
      return [{ tokenNumber: values[1] }];
    };
    Object.assign(w.db.client as object, { $queryRawUnsafe: rawSql });
  }

  beforeEach(() => {
    pinClock();
    today = formatDateKeyInIST(new Date());
    cache = new FakeQueueCache();
    const logging = { log: jest.fn(async (..._args: unknown[]) => undefined) };
    queueService = new AppointmentQueueService(cache as never, logging as never);
    w = buildCheckInServiceWorld({ cache, queue: queueService });
    w.db.insert('appointment', inPersonRow());
    w.db.insert(
      'appointment',
      inPersonRow({
        id: 'appt-2',
        patientId: 'patient-2',
        userId: 'user-other',
        doctorId: 'doctor-2',
      })
    );
    attachRawSql();
  });

  afterEach(() => {
    unpinClock();
  });

  const listOf = async (doctorId: string) =>
    (await cache.lRange(`queue:clinic:${CLINIC}:${doctorId}:${today}`, 0, -1)).map(
      raw => JSON.parse(raw) as { appointmentId: string; tokenNumber?: number; tokenLabel?: string }
    );

  it('stores the token on the appointment and queues that same token', async () => {
    await w.service.processCheckIn(checkInInput(), CLINIC, desk);

    expect(w.db.rows('appointment')[0]).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001' });
    expect((await listOf('doctor-1'))[0]).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001' });
    // the cache counter is no longer the source of truth
    expect(cache.counters.size).toBe(0);
  });

  it('a second doctor at the same location continues the ONE location series', async () => {
    await w.service.processCheckIn(checkInInput(), CLINIC, desk);
    await w.service.processCheckIn(
      checkInInput({ appointmentId: 'appt-2', patientId: 'patient-2' }),
      CLINIC,
      desk
    );

    expect((await listOf('doctor-2'))[0]).toMatchObject({ tokenNumber: 2, tokenLabel: 'K-002' });
  });

  it('after the cache is lost, a retry re-queues the stored token (no new K-001)', async () => {
    await w.service.processCheckIn(checkInInput(), CLINIC, desk);
    cache.lists.clear();
    cache.counters.clear();

    const retry = await w.service.processCheckIn(checkInInput(), CLINIC, desk);

    expect(retry.alreadyCheckedIn).toBe(true);
    expect(retry.queueRepaired).toBe(true);
    expect((await listOf('doctor-1'))[0]).toMatchObject({ tokenNumber: 1, tokenLabel: 'K-001' });
    expect([...counters.values()]).toEqual([1]);
  });
});
