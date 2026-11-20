import { describe, expect, it } from '@jest/globals';
import {
  participantLockKey,
  participantRoleFor,
  recordParticipantJoined,
  recordParticipantsLeft,
} from '@services/video/video-participants.helpers';
import type { RawSqlClient } from '@infrastructure/queue/src/services/location-token.allocator';

interface ParticipantRow {
  id: string;
  consultationId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date | null;
  leftAt: Date | null;
  duration: number | null;
}

const JOIN_AT = new Date('2026-11-20T08:45:00Z');
const LATER = new Date('2026-11-20T09:00:30Z');

/**
 * A tiny in-memory stand-in for the statements the helper runs, with a transaction-scoped
 * advisory lock: a second transaction asking for the same lock waits until the first one ends.
 */
function fakeDatabase(consultations: Array<{ id: string; appointmentId: string }>) {
  const rows: ParticipantRow[] = [];
  const held = new Map<string, Promise<void>>();

  function client(releases: Array<() => void>): RawSqlClient {
    return {
      $queryRawUnsafe: async <R>(sql: string, ...args: Array<string | number | null>) => {
        await Promise.resolve();
        if (sql.includes('pg_advisory_xact_lock')) {
          const key = String(args[0]);
          while (held.has(key)) await held.get(key);
          let release!: () => void;
          held.set(key, new Promise<void>(resolve => (release = resolve)));
          releases.push(() => {
            held.delete(key);
            release();
          });
          return [{ locked: 1 }] as unknown as R;
        }
        if (sql.includes('FROM "video_consultations" c') && sql.includes('LIMIT 1')) {
          const found = consultations.find(c => c.appointmentId === args[0]);
          return (found ? [{ id: found.id }] : []) as unknown as R;
        }
        if (sql.includes('FROM "video_participants" p') && sql.includes('LIMIT 1')) {
          const found = rows.find(r => r.consultationId === args[0] && r.userId === args[1]);
          return (found ? [{ id: found.id }] : []) as unknown as R;
        }
        if (sql.includes('INSERT INTO "video_participants"')) {
          const [id, consultationId, userId, role, at] = args as string[];
          rows.push({
            id: id!,
            consultationId: consultationId!,
            userId: userId!,
            role: role!,
            status: 'JOINED',
            joinedAt: new Date(at!),
            leftAt: null,
            duration: null,
          });
          return [{ id }] as unknown as R;
        }
        if (sql.includes('SET "status" = \'JOINED\'')) {
          const [id, at] = args as string[];
          const row = rows.find(r => r.id === id)!;
          row.status = 'JOINED';
          row.joinedAt = row.joinedAt ?? new Date(at!);
          row.leftAt = null;
          return [{ id }] as unknown as R;
        }
        if (sql.includes('SET "status" = \'LEFT\'')) {
          const [appointmentId, at, userId] = args as [string, string, string | null];
          const ids = new Set(
            consultations.filter(c => c.appointmentId === appointmentId).map(c => c.id)
          );
          const closed = rows.filter(
            r =>
              ids.has(r.consultationId) &&
              r.status === 'JOINED' &&
              r.joinedAt !== null &&
              (userId === null || r.userId === userId)
          );
          for (const row of closed) {
            row.status = 'LEFT';
            row.leftAt = new Date(at);
            row.duration = Math.max(
              0,
              Math.floor((row.leftAt.getTime() - row.joinedAt!.getTime()) / 1000)
            );
          }
          return closed.map(r => ({ id: r.id })) as unknown as R;
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };
  }

  async function transaction<T>(fn: (tx: RawSqlClient) => Promise<T>): Promise<T> {
    const releases: Array<() => void> = [];
    try {
      return await fn(client(releases));
    } finally {
      releases.forEach(release => release());
    }
  }

  return { rows, transaction, plain: client([]) };
}

describe('video participant recording', () => {
  it('maps the caller role to the participant role', () => {
    expect(participantRoleFor('doctor')).toBe('HOST');
    expect(participantRoleFor('patient')).toBe('PARTICIPANT');
    expect(participantRoleFor('receptionist')).toBe('OBSERVER');
    expect(participantRoleFor('clinic_admin')).toBe('OBSERVER');
  });

  it('records a first join as one JOINED row with the join time', async () => {
    const db = fakeDatabase([{ id: 'vc-1', appointmentId: 'appt-1' }]);

    const outcome = await db.transaction(tx =>
      recordParticipantJoined(tx, {
        appointmentId: 'appt-1',
        userId: 'patient-user',
        userRole: 'patient',
        now: JOIN_AT,
      })
    );

    expect(outcome.kind).toBe('joined');
    expect(db.rows).toEqual([
      expect.objectContaining({
        consultationId: 'vc-1',
        userId: 'patient-user',
        role: 'PARTICIPANT',
        status: 'JOINED',
        joinedAt: JOIN_AT,
        leftAt: null,
      }),
    ]);
  });

  it('does nothing when the appointment has no consultation yet', async () => {
    const db = fakeDatabase([]);

    const outcome = await db.transaction(tx =>
      recordParticipantJoined(tx, { appointmentId: 'appt-1', userId: 'u', userRole: 'doctor' })
    );

    expect(outcome).toEqual({ kind: 'no-consultation' });
    expect(db.rows).toHaveLength(0);
  });

  it('reopens the same row on a rejoin and keeps the first join time', async () => {
    const db = fakeDatabase([{ id: 'vc-1', appointmentId: 'appt-1' }]);
    const join = (now: Date) =>
      db.transaction(tx =>
        recordParticipantJoined(tx, {
          appointmentId: 'appt-1',
          userId: 'doctor-user',
          userRole: 'doctor',
          now,
        })
      );

    await join(JOIN_AT);
    await recordParticipantsLeft(db.plain, {
      appointmentId: 'appt-1',
      userId: 'doctor-user',
      now: LATER,
    });
    const second = await join(new Date('2026-11-20T09:05:00Z'));

    expect(second.kind).toBe('rejoined');
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toEqual(
      expect.objectContaining({ role: 'HOST', status: 'JOINED', joinedAt: JOIN_AT, leftAt: null })
    );
  });

  it('writes one row when two devices of the same user join at once', async () => {
    const db = fakeDatabase([{ id: 'vc-1', appointmentId: 'appt-1' }]);
    const join = () =>
      db.transaction(tx =>
        recordParticipantJoined(tx, {
          appointmentId: 'appt-1',
          userId: 'patient-user',
          userRole: 'patient',
          now: JOIN_AT,
        })
      );

    const outcomes = await Promise.all([join(), join(), join()]);

    expect(db.rows).toHaveLength(1);
    expect(outcomes.map(o => o.kind).sort()).toEqual(['joined', 'rejoined', 'rejoined']);
  });

  it("closes one user's row on leave, with the time spent in the call", async () => {
    const db = fakeDatabase([{ id: 'vc-1', appointmentId: 'appt-1' }]);
    for (const [userId, userRole] of [
      ['doctor-user', 'doctor'],
      ['patient-user', 'patient'],
    ] as const) {
      await db.transaction(tx =>
        recordParticipantJoined(tx, { appointmentId: 'appt-1', userId, userRole, now: JOIN_AT })
      );
    }

    const closed = await recordParticipantsLeft(db.plain, {
      appointmentId: 'appt-1',
      userId: 'patient-user',
      now: LATER,
    });

    expect(closed).toBe(1);
    const patient = db.rows.find(r => r.userId === 'patient-user');
    const doctor = db.rows.find(r => r.userId === 'doctor-user');
    expect(patient).toEqual(
      expect.objectContaining({ status: 'LEFT', leftAt: LATER, duration: 930 })
    );
    expect(doctor).toEqual(expect.objectContaining({ status: 'JOINED', leftAt: null }));
  });

  it('closes every open row when the consultation ends, and only open rows', async () => {
    const db = fakeDatabase([{ id: 'vc-1', appointmentId: 'appt-1' }]);
    for (const [userId, userRole] of [
      ['doctor-user', 'doctor'],
      ['patient-user', 'patient'],
    ] as const) {
      await db.transaction(tx =>
        recordParticipantJoined(tx, { appointmentId: 'appt-1', userId, userRole, now: JOIN_AT })
      );
    }
    await recordParticipantsLeft(db.plain, {
      appointmentId: 'appt-1',
      userId: 'patient-user',
      now: new Date('2026-11-20T08:50:00Z'),
    });

    const closed = await recordParticipantsLeft(db.plain, { appointmentId: 'appt-1', now: LATER });

    expect(closed).toBe(1);
    expect(db.rows.find(r => r.userId === 'doctor-user')).toEqual(
      expect.objectContaining({ status: 'LEFT', leftAt: LATER, duration: 930 })
    );
    // The patient's earlier leave is not moved by the end of the call.
    expect(db.rows.find(r => r.userId === 'patient-user')?.duration).toBe(300);
  });

  it('locks per consultation and user', () => {
    expect(participantLockKey('vc-1', 'u-1')).toBe('video-participant:vc-1:u-1');
  });
});
