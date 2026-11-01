import { describe, expect, it } from '@jest/globals';
import {
  claimQueueAlert,
  queueAlertClaimKeys,
  queueAlertTtlSeconds,
  queueLineOfEvent,
  queueNotifyKey,
  queueNotifyMessage,
  selectAlertableNotifications,
  selectQueueNotifications,
  QUEUE_ALERT_MIN_TTL_SECONDS,
  type AcquireOnce,
  type QueueAlertRow,
  type QueueNotifyEntry,
} from '@services/appointments/in-person/queue-notify.util';
import {
  QUEUE_PATIENT_ALERT_EVENT,
  isQueuePatientAlertEvent,
  queuePatientAlertContent,
  queuePatientAlertRecipientUserId,
} from '@communication/listeners/queue-patient-alert.util';

const DAY = '2026-11-01';

/** In-memory SET NX with TTL bookkeeping (what CacheService.acquireLock does on Dragonfly). */
function memoryAcquire(): { acquire: AcquireOnce; keys: Map<string, number> } {
  const keys = new Map<string, number>();
  return {
    keys,
    acquire: (key: string, ttlSeconds: number): Promise<boolean> => {
      if (keys.has(key)) return Promise.resolve(false);
      keys.set(key, ttlSeconds);
      return Promise.resolve(true);
    },
  };
}

function row(id: string, overrides: Partial<QueueAlertRow> = {}): QueueAlertRow {
  return {
    id,
    status: 'CONFIRMED',
    type: 'IN_PERSON',
    recipientUserId: `user-${id}`,
    doctorName: 'Dr. Rao',
    ...overrides,
  };
}

const doctorLine = (statuses: ReadonlyArray<[string, string]>): QueueNotifyEntry[] =>
  statuses.map(([appointmentId, status], index) => ({
    appointmentId,
    status,
    tokenNumber: index + 1,
    tokenLabel: `K-00${index + 1}`,
    doctorId: 'doc-1',
    locationId: 'loc-1',
    patientId: `patient-${appointmentId}`,
  }));

describe('queue position after a mutation (who crossed a threshold)', () => {
  it('call-next: the new head is NEXT, the next two are NEAR, the rest nothing', () => {
    const due = selectQueueNotifications(
      doctorLine([
        ['a0', 'IN_PROGRESS'],
        ['a1', 'WAITING'],
        ['a2', 'WAITING'],
        ['a3', 'CONFIRMED'],
        ['a4', 'WAITING'],
      ])
    );
    expect(due.map(d => [d.appointmentId, d.threshold, d.peopleAhead])).toEqual([
      ['a1', 'NEXT', 0],
      ['a2', 'NEAR', 1],
      ['a3', 'NEAR', 2],
    ]);
    expect(due[0]).toMatchObject({ doctorId: 'doc-1', token: 'K-002' });
  });
});

describe('selectAlertableNotifications (database agrees)', () => {
  const due = selectQueueNotifications(
    doctorLine([
      ['next', 'WAITING'],
      ['video', 'WAITING'],
      ['cancelled', 'WAITING'],
    ])
  );

  it('keeps in-person waiting visits with a user, resolved to the patient User.id', () => {
    const alerts = selectAlertableNotifications(due, [row('next')]);
    expect(alerts).toEqual([
      expect.objectContaining({
        appointmentId: 'next',
        recipientUserId: 'user-next',
        doctorName: 'Dr. Rao',
        threshold: 'NEXT',
      }),
    ]);
  });

  it('never alerts video, cancelled / completed / no-show, unknown or user-less visits', () => {
    const alerts = selectAlertableNotifications(due, [
      row('next', { recipientUserId: null }),
      row('video', { type: 'VIDEO_CALL' }),
      row('cancelled', { status: 'CANCELLED' }),
    ]);
    expect(alerts).toEqual([]);
    for (const status of ['COMPLETED', 'NO_SHOW', 'EXPIRED', 'IN_PROGRESS']) {
      expect(selectAlertableNotifications(due, [row('next', { status })])).toEqual([]);
    }
  });
});

describe('claimQueueAlert (idempotency per appointment + threshold)', () => {
  it('a repeated mutation, poll or cron run never re-notifies', async () => {
    const cache = memoryAcquire();
    expect(await claimQueueAlert(cache.acquire, 'a1', 'NEAR', 300)).toBe(true);
    expect(await claimQueueAlert(cache.acquire, 'a1', 'NEAR', 300)).toBe(false);
    expect(await claimQueueAlert(cache.acquire, 'a1', 'NEXT', 300)).toBe(true);
    expect(await claimQueueAlert(cache.acquire, 'a1', 'NEXT', 300)).toBe(false);
    expect(cache.keys.get(queueNotifyKey('a1', 'NEXT'))).toBe(300);
  });

  it('NEXT burns NEAR: a patient moved back after "you\'re next" is not told "2 ahead"', async () => {
    const cache = memoryAcquire();
    expect(await claimQueueAlert(cache.acquire, 'a2', 'NEXT', 60)).toBe(true);
    expect(await claimQueueAlert(cache.acquire, 'a2', 'NEAR', 60)).toBe(false);
  });

  it('keys are per appointment', async () => {
    const cache = memoryAcquire();
    expect(await claimQueueAlert(cache.acquire, 'a1', 'NEXT', 60)).toBe(true);
    expect(await claimQueueAlert(cache.acquire, 'b1', 'NEXT', 60)).toBe(true);
    expect(queueAlertClaimKeys('a1', 'NEAR')).toEqual([queueNotifyKey('a1', 'NEAR')]);
  });
});

describe('queueAlertTtlSeconds (claim lives until the end of the IST day)', () => {
  it('counts down to IST midnight', () => {
    // 2026-11-01 18:00 IST = 12:30 UTC; 6 h to midnight.
    expect(queueAlertTtlSeconds(new Date('2026-11-01T12:30:00.000Z'))).toBe(6 * 3600);
  });

  it('never drops under the floor right before midnight', () => {
    expect(queueAlertTtlSeconds(new Date('2026-11-01T18:29:59.900Z'))).toBe(
      QUEUE_ALERT_MIN_TTL_SECONDS
    );
  });
});

describe('queueLineOfEvent (which doctor line a queue.updated is about)', () => {
  it('reads the envelope payload', () => {
    expect(
      queueLineOfEvent(
        { payload: { clinicId: 'c1', doctorId: 'd1', domain: 'clinic', action: 'CALL_NEXT' } },
        DAY
      )
    ).toEqual({ clinicId: 'c1', ownerId: 'd1' });
    expect(
      queueLineOfEvent({ clinicId: 'c1', payload: { queueOwnerId: 'd2', doctorId: 'x' } }, DAY)
    ).toEqual({ clinicId: 'c1', ownerId: 'd2' });
  });

  it('ignores other domains, pauses, other days and incomplete events', () => {
    expect(
      queueLineOfEvent({ payload: { clinicId: 'c1', doctorId: 'd1', domain: 'pharmacy' } }, DAY)
    ).toBeNull();
    expect(
      queueLineOfEvent({ payload: { clinicId: 'c1', doctorId: 'd1', action: 'PAUSED' } }, DAY)
    ).toBeNull();
    expect(
      queueLineOfEvent({ payload: { clinicId: 'c1', doctorId: 'd1', date: '2026-11-02' } }, DAY)
    ).toBeNull();
    expect(queueLineOfEvent({ payload: { clinicId: 'c1' } }, DAY)).toBeNull();
    expect(queueLineOfEvent(undefined, DAY)).toBeNull();
  });
});

describe('alert text and listener routing', () => {
  it('names the doctor on NEXT and the count on NEAR', () => {
    const next = queueNotifyMessage(
      { threshold: 'NEXT', peopleAhead: 0, token: 'K-004' },
      'Dr. Rao'
    );
    expect(next.title).toBe("You're next");
    expect(next.body).toBe(
      "You're next in the queue (token K-004). Dr. Rao will call you shortly."
    );
    const near = queueNotifyMessage({ threshold: 'NEAR', peopleAhead: 2, token: null });
    expect(near.body).toBe(
      '2 patients ahead of you in the queue. Please be near the consultation room.'
    );
    expect(queueNotifyMessage({ threshold: 'NEXT', peopleAhead: 0, token: null }).body).toContain(
      'The doctor will call you shortly'
    );
  });

  it('the listener addresses the patient user and uses the emitted text', () => {
    expect(isQueuePatientAlertEvent(QUEUE_PATIENT_ALERT_EVENT)).toBe(true);
    expect(isQueuePatientAlertEvent('appointment.queue.position.updated')).toBe(false);
    const envelope = {
      userId: 'user-1',
      metadata: { title: "You're next", body: 'Dr. Rao will call you shortly.' },
    };
    expect(queuePatientAlertRecipientUserId(envelope)).toBe('user-1');
    expect(queuePatientAlertRecipientUserId({ metadata: { patientUserId: 'user-2' } })).toBe(
      'user-2'
    );
    expect(queuePatientAlertRecipientUserId({ metadata: {} })).toBeNull();
    expect(queuePatientAlertContent(envelope)).toEqual({
      title: "You're next",
      body: 'Dr. Rao will call you shortly.',
    });
  });
});
