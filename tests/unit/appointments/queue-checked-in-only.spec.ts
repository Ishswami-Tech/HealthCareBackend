/**
 * V2 rule 6: the doctor's consultation queue lists ONLY checked-in patients, and the doctor can
 * call / start only a checked-in appointment (409 NOT_CHECKED_IN otherwise).
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { QueueController } from '@infrastructure/queue/src/controllers/queue.controller';

type Row = {
  id: string;
  type: string;
  status: string;
  checkedInAt: Date | null;
  date?: Date;
  time?: string;
  patient?: unknown;
  doctor?: unknown;
  payment?: unknown;
};

function build(
  rows: Row[],
  queue: Array<Record<string, unknown>>,
  rawStart?: (sql: string, ...args: unknown[]) => Promise<unknown[]>
) {
  const appointmentQueueService = {
    getDoctorQueue: jest.fn(async () => ({ queue })),
    getQueuePauseStatus: jest.fn(async () => null),
  };
  const queueService = { addJob: jest.fn(async () => ({ id: 'job-1' })) };
  const database = {
    executeHealthcareRead: jest.fn(async (fn: (client: unknown) => unknown) =>
      fn({
        appointment: {
          findFirst: async ({ where }: { where: { id: string } }) =>
            rows.find(r => r.id === where.id) ?? null,
          findMany: async () => rows,
        },
        doctor: { findFirst: async () => ({ id: 'doc-1' }) },
      })
    ),
    // The atomic start (H2) runs raw SQL on a transaction client; the plain fake has none, so the
    // start is left to the queue worker as before. `rawStart` simulates a real client.
    executeInTransaction: jest.fn(async (fn: (client: unknown) => unknown) =>
      fn(rawStart ? { $queryRawUnsafe: rawStart } : {})
    ),
  };
  const controller = new QueueController(
    appointmentQueueService as never,
    queueService as never,
    {} as never,
    database as never
  );
  return { controller, queueService };
}

const req = (role: string) =>
  ({ user: { sub: 'u-1', role }, clinicContext: { clinicId: 'clinic-1' } }) as never;

describe('POST /queue/call-next (doctor only, checked-in only)', () => {
  it('409 NOT_CHECKED_IN for a booked appointment that never checked in', async () => {
    const { controller, queueService } = build(
      [{ id: 'a1', type: 'IN_PERSON', status: 'SCHEDULED', checkedInAt: null }],
      []
    );
    await expect(
      controller.callNext({ doctorId: 'doc-1', appointmentId: 'a1' }, req('DOCTOR'))
    ).rejects.toBeInstanceOf(ConflictException);
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('calls a checked-in patient', async () => {
    const { controller, queueService } = build(
      [{ id: 'a1', type: 'IN_PERSON', status: 'CONFIRMED', checkedInAt: new Date() }],
      []
    );
    await expect(
      controller.callNext({ doctorId: 'doc-1', appointmentId: 'a1' }, req('DOCTOR'))
    ).resolves.toMatchObject({ success: true });
    expect(queueService.addJob).toHaveBeenCalledWith(
      expect.anything(),
      'queue.call_next',
      expect.objectContaining({ appointmentId: 'a1' })
    );
  });

  it('409 CONSULTATION_IN_PROGRESS when the doctor already has a consultation in progress (H2)', async () => {
    const rawStart = jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }];
      if (sql.includes('LIMIT 1')) return [{ id: 'other-visit' }];
      return [{ id: 'a1', doctorId: 'doc-1', status: 'CONFIRMED', checkedInAt: new Date() }];
    });
    const { controller, queueService } = build(
      [{ id: 'a1', type: 'IN_PERSON', status: 'CONFIRMED', checkedInAt: new Date() }],
      [],
      rawStart
    );
    const error = await controller
      .callNext({ doctorId: 'doc-1', appointmentId: 'a1' }, req('DOCTOR'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'CONSULTATION_IN_PROGRESS',
      message: 'Finish the current consultation first',
    });
    expect(queueService.addJob).not.toHaveBeenCalled();
  });

  it('reception / assistant cannot call', async () => {
    const { controller } = build([], []);
    for (const role of ['RECEPTIONIST', 'ASSISTANT_DOCTOR', 'CLINIC_ADMIN']) {
      await expect(
        controller.callNext({ doctorId: 'doc-1', appointmentId: 'a1' }, req(role))
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

describe('PATCH /queue/:id/status IN_PROGRESS', () => {
  it('409 for a confirmed row without a recorded arrival', async () => {
    const { controller } = build(
      [{ id: 'a1', type: 'IN_PERSON', status: 'CONFIRMED', checkedInAt: null }],
      []
    );
    await expect(
      controller.updateQueueStatus('a1', { status: 'IN_PROGRESS' }, req('DOCTOR'))
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'NOT_CHECKED_IN' }) });
  });
});

describe('GET /queue?doctorId lists checked-in patients only', () => {
  it('drops queue rows whose appointment never checked in and adds token + stage', async () => {
    const rows: Row[] = [
      {
        id: 'in',
        type: 'IN_PERSON',
        status: 'CONFIRMED',
        checkedInAt: new Date(),
        date: new Date(),
        time: '10:00',
      },
      {
        id: 'out',
        type: 'IN_PERSON',
        status: 'SCHEDULED',
        checkedInAt: null,
        date: new Date(),
        time: '10:15',
      },
    ];
    const { controller } = build(rows, [
      {
        appointmentId: 'in',
        patientId: 'p1',
        doctorId: 'doc-1',
        status: 'WAITING',
        tokenNumber: 14,
      },
      {
        appointmentId: 'out',
        patientId: 'p2',
        doctorId: 'doc-1',
        status: 'WAITING',
        tokenNumber: 15,
      },
    ]);
    const result = await controller.listQueue({ doctorId: 'doc-1' } as never, req('DOCTOR'));
    expect(result.data.map(entry => entry.appointmentId)).toEqual(['in']);
    expect(result.data[0]).toMatchObject({ token: 'K-014', stage: 'CHECKED_IN' });
  });
});
