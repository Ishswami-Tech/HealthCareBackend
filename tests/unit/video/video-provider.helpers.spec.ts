/// <reference types="jest" />
/**
 * Unit tests for the shared video provider persistence helpers:
 * first-join race handling and the consultation start/end state rules.
 */

import type { DatabaseService } from '@infrastructure/database/database.service';
import {
  isUniqueConstraintViolation,
  markConsultationActive,
  markConsultationEnded,
  upsertConsultationRecord,
} from '@services/video/providers/video-provider.helpers';

type ConsultationRow = {
  id: string;
  appointmentId: string;
  roomId: string;
  status: string;
  startTime: Date | null;
  endTime: Date | null;
};

type Delegate = {
  findFirst: jest.Mock;
  update: jest.Mock;
  create: jest.Mock;
  upsert: jest.Mock;
};

function createDatabase(initialRow: ConsultationRow | null): {
  database: DatabaseService;
  delegate: Delegate;
  findAppointmentByIdSafe: jest.Mock;
} {
  const delegate: Delegate = {
    findFirst: jest.fn().mockResolvedValue(initialRow),
    update: jest.fn().mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      ...(initialRow ?? {}),
      ...args.data,
    })),
    create: jest.fn(),
    upsert: jest
      .fn()
      .mockImplementation(async (args: { create: Record<string, unknown> }) => args.create),
  };
  const findAppointmentByIdSafe = jest.fn().mockResolvedValue({
    id: 'appt-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    clinicId: 'clinic-1',
    patient: { userId: 'patient-user' },
    doctor: { userId: 'doctor-user' },
  });
  const database = {
    findAppointmentByIdSafe,
    executeHealthcareWrite: jest.fn(
      async (operation: (client: unknown) => Promise<unknown>): Promise<unknown> =>
        operation({ videoConsultation: delegate })
    ),
  } as unknown as DatabaseService;
  return { database, delegate, findAppointmentByIdSafe };
}

const JOIN_DATA = {
  roomId: 'daily-appointment-appt-1-abc',
  roomName: 'daily-appointment-appt-1-abc',
  meetingUrl: 'https://example.daily.co/room',
  token: 'token',
};
const FLAGS = {
  recordingEnabled: false,
  screenSharingEnabled: true,
  chatEnabled: true,
  waitingRoomEnabled: true,
};

function row(overrides: Partial<ConsultationRow> = {}): ConsultationRow {
  return {
    id: 'vc-1',
    appointmentId: 'appt-1',
    roomId: JOIN_DATA.roomId,
    status: 'SCHEDULED',
    startTime: null,
    endTime: null,
    ...overrides,
  };
}

describe('upsertConsultationRecord', () => {
  it('creates the first record with an upsert keyed on the unique roomId', async () => {
    const { database, delegate } = createDatabase(null);

    await upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS);

    expect(delegate.upsert).toHaveBeenCalledTimes(1);
    const args = delegate.upsert.mock.calls[0]?.[0] as {
      where: { roomId: string };
      create: { status: string; clinicId: string };
      update: Record<string, unknown>;
    };
    expect(args.where).toEqual({ roomId: JOIN_DATA.roomId });
    expect(args.create.status).toBe('SCHEDULED');
    expect(args.create.clinicId).toBe('clinic-1');
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('never resets the status of an existing consultation when the token is re-issued', async () => {
    const { database, delegate } = createDatabase(row({ status: 'ACTIVE' }));

    await upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS);

    const updateArgs = delegate.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(updateArgs.data).not.toHaveProperty('status');
    expect(delegate.upsert).not.toHaveBeenCalled();
  });

  it('retries once on a unique-constraint failure so simultaneous first joins both succeed', async () => {
    const { database, delegate } = createDatabase(null);
    const raceLoser = Object.assign(
      new Error('Unique constraint failed on the fields: (`roomId`)'),
      {
        code: 'P2002',
      }
    );
    delegate.upsert.mockRejectedValueOnce(raceLoser);
    // After the winner committed, the retry sees the row and takes the update path.
    delegate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());

    const result = await upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS);

    expect(delegate.upsert).toHaveBeenCalledTimes(1);
    expect(delegate.update).toHaveBeenCalledTimes(1);
    expect(result.roomId).toBe(JOIN_DATA.roomId);
  });

  it('recognises a unique-constraint failure wrapped by the database layer', async () => {
    const { database, delegate } = createDatabase(null);
    const wrapped = new Error(
      'Write operation failed after 3 attempts: Unique constraint failed on the fields: (`roomId`)'
    );
    delegate.upsert.mockRejectedValueOnce(wrapped);
    delegate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(row());

    await expect(
      upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS)
    ).resolves.toBeDefined();
  });

  it('does not swallow other database failures', async () => {
    const { database, delegate } = createDatabase(null);
    delegate.upsert.mockRejectedValue(new Error('connection reset'));

    await expect(upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS)).rejects.toThrow(
      'connection reset'
    );
    expect(delegate.upsert).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the appointment does not exist', async () => {
    const { database, findAppointmentByIdSafe } = createDatabase(null);
    findAppointmentByIdSafe.mockResolvedValue(null);

    await expect(
      upsertConsultationRecord(database, 'appt-1', JOIN_DATA, FLAGS)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('isUniqueConstraintViolation', () => {
  it('detects P2002 by code or message and ignores other errors', () => {
    expect(isUniqueConstraintViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueConstraintViolation(new Error('Unique constraint failed on x'))).toBe(true);
    expect(isUniqueConstraintViolation(new Error('P2002'))).toBe(true);
    expect(isUniqueConstraintViolation(new Error('timeout'))).toBe(false);
    expect(isUniqueConstraintViolation('P2002')).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
  });
});

describe('markConsultationActive', () => {
  it('stamps startTime on the first start', async () => {
    const { database, delegate } = createDatabase(row());

    await markConsultationActive(database, 'appt-1');

    const data = (delegate.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data['status']).toBe('ACTIVE');
    expect(data['startTime']).toBeInstanceOf(Date);
  });

  it('keeps the original startTime when started again', async () => {
    const started = new Date('2026-03-10T04:30:00.000Z');
    const { database, delegate } = createDatabase(row({ status: 'SCHEDULED', startTime: started }));

    await markConsultationActive(database, 'appt-1');

    const data = (delegate.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data['startTime']).toBe(started);
  });

  it('does not write at all when the consultation is already ACTIVE with a startTime', async () => {
    const started = new Date('2026-03-10T04:30:00.000Z');
    const { database, delegate } = createDatabase(row({ status: 'ACTIVE', startTime: started }));

    const result = await markConsultationActive(database, 'appt-1');

    expect(delegate.update).not.toHaveBeenCalled();
    expect(result?.startTime).toBe(started);
  });

  it.each(['COMPLETED', 'ENDED', 'CANCELLED'])(
    'never moves a %s consultation back to ACTIVE',
    async status => {
      const { database, delegate } = createDatabase(row({ status, endTime: new Date() }));

      const result = await markConsultationActive(database, 'appt-1');

      expect(delegate.update).not.toHaveBeenCalled();
      expect(result?.status).toBe(status);
    }
  );

  it('returns null when there is no consultation row', async () => {
    const { database } = createDatabase(null);

    await expect(markConsultationActive(database, 'appt-1')).resolves.toBeNull();
  });
});

describe('markConsultationEnded', () => {
  it('completes an active consultation and stamps endTime', async () => {
    const { database, delegate } = createDatabase(row({ status: 'ACTIVE' }));

    await markConsultationEnded(database, 'appt-1');

    const data = (delegate.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data['status']).toBe('COMPLETED');
    expect(data['endTime']).toBeInstanceOf(Date);
  });

  it('is idempotent: ending twice keeps the original endTime', async () => {
    const endedAt = new Date('2026-03-10T05:00:00.000Z');
    const { database, delegate } = createDatabase(row({ status: 'COMPLETED', endTime: endedAt }));

    const result = await markConsultationEnded(database, 'appt-1');

    expect(delegate.update).not.toHaveBeenCalled();
    expect(result?.endTime).toBe(endedAt);
  });

  it('returns null when there is no consultation row', async () => {
    const { database } = createDatabase(null);

    await expect(markConsultationEnded(database, 'appt-1')).resolves.toBeNull();
  });
});
