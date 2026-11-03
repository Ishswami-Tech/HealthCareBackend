/**
 * Live queue durability (audit P0-1): the per doctor/day live list lives only in Dragonfly. After
 * the list is lost, every queue read / mutation rebuilds it from the database (checked-in
 * arrivals of today, CONFIRMED / IN_PROGRESS, with the token stored at check-in) in serving order:
 * priority first, then token. Real AppointmentQueueService over the in-memory cache.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });

import { AppointmentQueueService } from '@infrastructure/queue';
import {
  compareLiveQueueEntries,
  compareRebuildRows,
  dedupeQueueEntries,
  groupRebuildRowsByDoctor,
  rebuildPriorityWeight,
  toRebuiltEntry,
  type LiveQueueRebuildRow,
} from '@infrastructure/queue/src/services/live-queue-rebuild.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { FakeQueueCache } from './fake-queue-cache';
import { pinClock, unpinClock } from './check-in-time-helpers';

const CLINIC = 'clinic-1';

function row(overrides: Partial<LiveQueueRebuildRow> & { id: string }): LiveQueueRebuildRow {
  return {
    doctorId: 'doctor-1',
    patientId: `patient-${overrides.id}`,
    clinicId: CLINIC,
    locationId: 'loc-kothrud',
    type: 'IN_PERSON',
    status: 'CONFIRMED',
    priority: 'NORMAL',
    metadata: null,
    checkedInAt: new Date(),
    startedAt: null,
    tokenNumber: null,
    tokenLabel: null,
    ...overrides,
  };
}

describe('rebuild ordering and entry shape (pure)', () => {
  it('orders by priority (EMERGENCY > HIGH > NORMAL), then token at the location, else arrival', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 4, minutes));
    const rows = [
      row({ id: 'n3', tokenNumber: 3, checkedInAt: at(3) }),
      row({ id: 'n1', tokenNumber: 1, checkedInAt: at(9) }),
      row({ id: 'senior', tokenNumber: 5, priority: 'HIGH', checkedInAt: at(5) }),
      row({ id: 'em', tokenNumber: 7, priority: 'EMERGENCY', checkedInAt: at(7) }),
      row({ id: 'legacy', tokenNumber: null, checkedInAt: at(0) }),
      row({ id: 'n2', tokenNumber: 2, checkedInAt: at(1) }),
    ];

    expect([...rows].sort(compareRebuildRows).map(r => r.id)).toEqual([
      'em',
      'senior',
      'legacy', // no stored token (checked in before tokens were persisted): by arrival time
      'n1',
      'n2',
      'n3',
    ]);
  });

  it('a burst of parallel check-ins is served in token order, not by ms arrival stamps', () => {
    const entries = [
      { priority: 0, tokenNumber: 476, locationId: 'loc', checkedInAt: '2026-10-22T04:00:00.010Z' },
      { priority: 0, tokenNumber: 474, locationId: 'loc', checkedInAt: '2026-10-22T04:00:00.030Z' },
      { priority: 0, tokenNumber: 475, locationId: 'loc', checkedInAt: '2026-10-22T04:00:00.020Z' },
      // another location's series is not comparable by number: arrival time decides
      { priority: 0, tokenNumber: 1, locationId: 'other', checkedInAt: '2026-10-22T04:00:00.040Z' },
    ];

    expect([...entries].sort(compareLiveQueueEntries).map(e => e.tokenNumber)).toEqual([
      474, 475, 476, 1,
    ]);
  });

  it('NORMAL weighs 0 like a check-in without a raised priority', () => {
    expect(rebuildPriorityWeight('NORMAL')).toBe(0);
    expect(rebuildPriorityWeight(null)).toBe(0);
    expect(rebuildPriorityWeight('high')).toBe(50);
    expect(rebuildPriorityWeight('EMERGENCY')).toBe(100);
  });

  it('maps a DB row to the entry check-in writes (status, token, tags, priority label)', () => {
    const started = new Date(Date.UTC(2026, 9, 22, 5, 0));
    const entry = toRebuiltEntry(
      row({
        id: 'a-1',
        status: 'IN_PROGRESS',
        startedAt: started,
        tokenNumber: 4,
        tokenLabel: 'K-004',
        priority: 'HIGH',
        metadata: { isWalkIn: true, priorityLabel: 'SENIOR', priorityReason: '78 years' },
      }),
      () => 'Consultation'
    );

    expect(entry).toMatchObject({
      appointmentId: 'a-1',
      doctorId: 'doctor-1',
      status: 'IN_PROGRESS',
      startedAt: started.toISOString(),
      tokenNumber: 4,
      tokenLabel: 'K-004',
      isWalkIn: true,
      priority: 50,
      priorityLabel: 'SENIOR',
      priorityReason: '78 years',
      locationId: 'loc-kothrud',
      displayLabel: 'Consultation',
    });
    expect(toRebuiltEntry(row({ id: 'w' }), () => 'x').status).toBe('WAITING');
  });

  it('groups per doctor (one live list each) and drops duplicate rows', () => {
    const groups = groupRebuildRowsByDoctor([
      row({ id: 'a', tokenNumber: 2 }),
      row({ id: 'b', doctorId: 'doctor-2', tokenNumber: 1 }),
      row({ id: 'c', tokenNumber: 1 }),
      row({ id: 'a', tokenNumber: 2 }),
    ]);

    expect(groups.get('doctor-1')?.map(r => r.id)).toEqual(['c', 'a']);
    expect(groups.get('doctor-2')?.map(r => r.id)).toEqual(['b']);
  });

  it('dedupeQueueEntries keeps the first entry of an appointment', () => {
    expect(
      dedupeQueueEntries([
        { appointmentId: 'x', n: 1 },
        { appointmentId: 'y', n: 2 },
        { appointmentId: 'x', n: 3 },
      ]).map(entry => entry.n)
    ).toEqual([1, 2]);
  });
});

describe('AppointmentQueueService rebuilds a lost live queue from the database', () => {
  let cache: FakeQueueCache;
  let rows: LiveQueueRebuildRow[];
  let findMany: jest.Mock<(args: unknown) => Promise<LiveQueueRebuildRow[]>>;
  let service: AppointmentQueueService;
  let today: string;
  let logging: { log: jest.Mock<(...args: unknown[]) => Promise<undefined>> };

  const listKey = (doctorId = 'doctor-1'): string => `queue:clinic:${CLINIC}:${doctorId}:${today}`;

  beforeEach(() => {
    pinClock();
    today = formatDateKeyInIST(new Date());
    cache = new FakeQueueCache();
    rows = [];
    findMany = jest.fn(async (_args: unknown) => rows);
    const database = {
      executeHealthcareRead: async <T>(fn: (client: unknown) => Promise<T>) =>
        fn({ appointment: { findMany } }),
      executeInTransaction: async <T>(fn: (client: unknown) => Promise<T>) => fn({}),
    };
    logging = { log: jest.fn(async (..._args: unknown[]) => undefined) };
    service = new AppointmentQueueService(
      cache as never,
      logging as never,
      undefined,
      database as never
    );
  });

  afterEach(() => {
    unpinClock();
  });

  it('after a cache flush, GET /queue (doctor) returns the same entries, tokens and order', async () => {
    rows = [
      row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' }),
      row({ id: 'k3', tokenNumber: 3, tokenLabel: 'K-003', priority: 'EMERGENCY' }),
      row({ id: 'k2', tokenNumber: 2, tokenLabel: 'K-002', status: 'IN_PROGRESS' }),
    ];

    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    expect(queue.queue.map(entry => entry.tokenLabel)).toEqual(['K-003', 'K-001', 'K-002']);
    expect(queue.queue.map(entry => entry.position)).toEqual([1, 2, 3]);
    expect(queue.queue.find(entry => entry.appointmentId === 'k2')?.status).toBe('IN_PROGRESS');
    expect(await cache.lLen(listKey())).toBe(3);
    // the query is bounded and scoped to the clinic's arrivals of today
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(args.where).toMatchObject({
      clinicId: CLINIC,
      status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
    });
    expect(args.take).toBeGreaterThan(0);
  });

  it('rebuilds every doctor list of a multi-doctor location (clinic-wide read)', async () => {
    rows = [
      row({ id: 'a1', tokenNumber: 1, tokenLabel: 'K-001' }),
      row({ id: 'b1', doctorId: 'doctor-2', tokenNumber: 2, tokenLabel: 'K-002' }),
    ];

    const clinicQueue = await service.getClinicQueue(CLINIC, today, 'clinic');

    expect(clinicQueue.map(entry => entry.tokenLabel).sort()).toEqual(['K-001', 'K-002']);
    expect(await cache.lLen(listKey('doctor-1'))).toBe(1);
    expect(await cache.lLen(listKey('doctor-2'))).toBe(1);
  });

  it('checks the database at most once per short window (no query per poll)', async () => {
    rows = [row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' })];

    await service.getClinicQueue(CLINIC, today, 'clinic');
    await service.getClinicQueue(CLINIC, today, 'clinic');
    await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('never overwrites a list that still exists', async () => {
    await cache.rPush(
      listKey(),
      JSON.stringify({ appointmentId: 'live', doctorId: 'doctor-1', status: 'WAITING' })
    );
    rows = [row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' })];

    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    expect(queue.queue.map(entry => entry.appointmentId)).toEqual(['live']);
  });

  it('another replica rebuilding (lock held) is waited for, not repeated', async () => {
    rows = [row({ id: 'k1', tokenNumber: 1 })];
    cache.locks.add(`lock:queue-rebuild:clinic:${CLINIC}:${today}`);
    setTimeout(() => {
      void cache.set(`queue-rebuild:checked:clinic:${CLINIC}:${today}`, '1');
    }, 50);

    await service.getClinicQueue(CLINIC, today, 'clinic');

    expect(findMany).not.toHaveBeenCalled();
  });

  it('a check-in after the flush lands behind the rebuilt arrivals, keeping its stored token', async () => {
    rows = [
      row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' }),
      row({ id: 'k2', tokenNumber: 2, tokenLabel: 'K-002' }),
    ];

    await service.checkIn(
      {
        appointmentId: 'k3',
        doctorId: 'doctor-1',
        patientId: 'patient-k3',
        clinicId: CLINIC,
        locationId: 'loc-kothrud',
        tokenNumber: 3,
        tokenLabel: 'K-003',
      },
      'clinic'
    );

    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');
    expect(queue.queue.map(entry => entry.tokenLabel)).toEqual(['K-001', 'K-002', 'K-003']);
  });

  const checkInOf = (id: string, tokenNumber: number) => ({
    appointmentId: id,
    doctorId: 'doctor-1',
    patientId: `patient-${id}`,
    clinicId: CLINIC,
    locationId: 'loc-kothrud',
    tokenNumber,
    tokenLabel: `K-${String(tokenNumber).padStart(3, '0')}`,
  });

  it('two concurrent check-ins after a flush both land in the rebuilt queue exactly once', async () => {
    // Both arrivals are already recorded in the database (check-in writes the row first).
    rows = [
      row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' }),
      row({ id: 'k2', tokenNumber: 2, tokenLabel: 'K-002' }),
      row({ id: 'k3', tokenNumber: 3, tokenLabel: 'K-003' }),
      row({ id: 'k4', tokenNumber: 4, tokenLabel: 'K-004' }),
    ];

    await Promise.all([
      service.checkIn(checkInOf('k3', 3), 'clinic').catch(() => undefined),
      service.checkIn(checkInOf('k4', 4), 'clinic').catch(() => undefined),
    ]);

    const ids = (await cache.lRange(listKey(), 0, -1)).map(
      entry => (JSON.parse(entry) as { appointmentId: string }).appointmentId
    );
    expect([...ids].sort()).toEqual(['k1', 'k2', 'k3', 'k4']);
    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');
    expect(queue.queue.map(entry => entry.tokenLabel)).toEqual([
      'K-001',
      'K-002',
      'K-003',
      'K-004',
    ]);
  });

  it('a check-in whose clinic-wide hydration was skipped still refills the empty list under its lock', async () => {
    rows = [
      row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' }),
      row({ id: 'k2', tokenNumber: 2, tokenLabel: 'K-002' }),
      row({ id: 'k3', tokenNumber: 3, tokenLabel: 'K-003' }),
    ];
    // Another replica holds the clinic/day rebuild lock and never finishes within the wait.
    cache.locks.add(`lock:queue-rebuild:clinic:${CLINIC}:${today}`);

    await service.checkIn(checkInOf('k3', 3), 'clinic');

    const ids = (await cache.lRange(listKey(), 0, -1)).map(
      entry => (JSON.parse(entry) as { appointmentId: string }).appointmentId
    );
    expect(ids).toEqual(['k1', 'k2', 'k3']);
  });

  it('a rebuild that cannot take a busy list lock logs a warning instead of skipping silently', async () => {
    rows = [row({ id: 'k1', tokenNumber: 1, tokenLabel: 'K-001' })];
    cache.locks.add(`lock:${listKey()}`);

    await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    const messages = logging.log.mock.calls.map(call => String(call[2]));
    expect(messages).toContain(
      'Live queue rebuild skipped a list: its queue lock is held by another operation'
    );
  });

  it('a duplicate entry (check-in racing the rebuild) is shown once', async () => {
    const entry = JSON.stringify({
      appointmentId: 'k1',
      doctorId: 'doctor-1',
      status: 'WAITING',
      tokenNumber: 1,
    });
    await cache.rPush(listKey(), entry, entry);

    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    expect(queue.queue).toHaveLength(1);
  });

  it('a database failure never fails the queue read (logged, cache view served)', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'));

    const queue = await service.getDoctorQueue('doctor-1', CLINIC, today, 'clinic');

    expect(queue.queue).toEqual([]);
  });

  it('other queue domains (pharmacy desk) are never rebuilt from appointments', async () => {
    rows = [row({ id: 'k1', tokenNumber: 1 })];

    await service.getClinicQueue(CLINIC, today, 'pharmacy');

    expect(findMany).not.toHaveBeenCalled();
  });
});
