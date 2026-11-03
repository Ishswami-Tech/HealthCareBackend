/**
 * InPersonDeskService - walk-in (book now + the shared check-in, idempotent) and undo no-show
 * (back to CONFIRMED and into the live queue through the one check-in service). Fakes only.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InPersonDeskService } from '@services/appointments/in-person/in-person-desk.service';
import type { InPersonAppointmentRow } from '@services/appointments/in-person/in-person-visit.service';
import type { InPersonVisit } from '@services/appointments/in-person/in-person.types';
import { formatDateKeyInIST } from '@utils/date-time.util';

const CLINIC = 'clinic-1';
const LOC = 'loc-a';

function row(over: Partial<InPersonAppointmentRow> = {}): InPersonAppointmentRow {
  return {
    id: 'apt-1',
    clinicId: CLINIC,
    patientId: 'pat-1',
    doctorId: 'doc-1',
    userId: 'user-1',
    familyMemberId: null,
    locationId: LOC,
    type: 'IN_PERSON',
    status: 'NO_SHOW',
    date: new Date(`${formatDateKeyInIST(new Date())}T00:00:00.000Z`),
    time: '10:00',
    duration: 15,
    priority: 'NORMAL',
    checkedInAt: new Date(),
    startedAt: null,
    completedAt: null,
    patient: { user: { name: 'Asha', firstName: null, lastName: null } },
    doctor: { user: { name: 'Dr. D', firstName: null, lastName: null } },
    location: { name: 'Kothrud' },
    ...over,
  };
}

const visitOf = (r: InPersonAppointmentRow): InPersonVisit =>
  ({ appointmentId: r.id, appointmentStatus: r.status, locationId: r.locationId }) as InPersonVisit;

function build(
  options: {
    appointment?: InPersonAppointmentRow;
    openToday?: { id: string; subscriptionId?: string | null } | null;
    plan?: { subscriptionId: string; patientUserId: string } | null;
    linkFails?: boolean;
    patient?: { id: string; userId: string } | null;
    createResults?: Array<
      'conflict' | { success: boolean; data?: { id: string }; error?: string; message?: string }
    >;
    /** Free in-person slots the availability grid returns for today. */
    freeSlots?: string[];
    /** Free slots per IST day key (overrides freeSlots; a missing day has none). */
    slotsByDate?: Record<string, string[]>;
    /** Clinic.settings (working days, walk-in-without-plan rule). */
    clinicSettings?: unknown;
    /** Billing fallback consultation fee (Doctor / clinic OPD fee). */
    consultationFee?: number | null;
  } = {}
) {
  let current = options.appointment ?? row();
  const writes: Array<Record<string, unknown>> = [];
  let visitMetadata: Record<string, unknown> = { isWalkIn: true };
  const client = {
    clinic: {
      findUnique: jest.fn(async () => ({ settings: options.clinicSettings ?? {} })),
    },
    invoice: {
      findFirst: jest.fn(async () => null),
    },
    patient: {
      findFirst: jest.fn(async () =>
        options.patient === undefined ? { id: 'pat-1', userId: 'user-1' } : options.patient
      ),
    },
    clinicLocation: {
      findFirst: jest.fn(async () => ({ id: LOC })),
      findMany: jest.fn(async () => [{ id: LOC }]),
    },
    appointment: {
      findFirst: jest.fn(
        async (args: { where: { status?: unknown; patientId?: unknown; id?: string } }) => {
          if (args.where.status === 'NO_SHOW')
            return current.status === 'NO_SHOW' ? { id: current.id } : null;
          if (args.where.patientId === undefined && args.where.id) {
            // The plan-waiver lookup of one visit.
            return {
              id: args.where.id,
              clinicId: CLINIC,
              patientId: 'pat-1',
              doctorId: 'doc-1',
              date: new Date('2026-10-21T00:00:00.000Z'),
              metadata: visitMetadata,
            };
          }
          return options.openToday ?? null;
        }
      ),
      updateMany: jest.fn(
        async (args: {
          where: { status?: string };
          data: { status?: string; metadata?: Record<string, unknown> };
        }) => {
          writes.push(args.data);
          if (args.where.status === undefined && args.data.metadata) {
            visitMetadata = args.data.metadata;
            return { count: 1 };
          }
          if (current.status !== args.where.status) return { count: 0 };
          current = { ...current, status: args.data.status as string };
          return { count: 1 };
        }
      ),
    },
  };
  const database = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => unknown) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => unknown) => op(client)),
  };
  const createQueue = [...(options.createResults ?? [{ success: true, data: { id: 'apt-new' } }])];
  const appointments = {
    resolveSingleDoctorId: jest.fn(async () => 'doc-1'),
    getDoctorAvailability: jest.fn(async (_doctorId: string, date: string) => ({
      success: true,
      data: {
        availableSlots: options.slotsByDate
          ? (options.slotsByDate[date] ?? [])
          : (options.freeSlots ?? ['10:00', '10:30', '10:33', '10:36', '11:00']),
      },
    })),
    createAppointment: jest.fn(async () => {
      const next = createQueue.shift() ?? { success: true, data: { id: 'apt-new' } };
      if (next === 'conflict') throw new ConflictException('slot taken');
      return next;
    }),
    findActiveInPersonPlan: jest.fn(async () =>
      options.plan === undefined
        ? { subscriptionId: 'sub-1', patientUserId: 'user-1' }
        : options.plan
    ),
    linkInPersonPlan: jest.fn(async () => {
      if (options.linkFails) throw new Error('plan quota used up');
    }),
    cancelAppointment: jest.fn(async () => ({ success: true })),
  };
  const checkIns = {
    checkInManually: jest.fn(async (id: string) => ({
      result: 'CHECKED_IN' as const,
      alreadyCheckedIn: false,
      visit: { appointmentId: id } as InPersonVisit,
    })),
  };
  const visits = {
    resolveReceptionistLocation: jest.fn(async () => LOC),
    loadForActor: jest.fn(async () => current),
    toVisits: jest.fn(async (rows: InPersonAppointmentRow[]) => rows.map(visitOf)),
  };
  const checkInLocations = {
    processCheckIn: jest.fn(async () => ({ alreadyCheckedIn: true, queueRepaired: true })),
  };
  const cache = { invalidateAppointmentCache: jest.fn(async () => 1) };
  const events = { emit: jest.fn(async () => undefined) };
  const logging = { log: jest.fn(async () => undefined) };
  const billing = {
    resolveConsultationFee: jest.fn(async () =>
      options.consultationFee === undefined ? null : options.consultationFee
    ),
    createInvoice: jest.fn(async () => ({ id: 'inv-desk-1' })),
  };
  const service = new InPersonDeskService(
    database as never,
    appointments as never,
    checkIns as never,
    visits as never,
    checkInLocations as never,
    cache as never,
    events as never,
    logging as never,
    billing as never
  );
  return {
    service,
    appointments,
    checkIns,
    visits,
    checkInLocations,
    client,
    writes,
    cache,
    billing,
  };
}

const RECEPTION = { userId: 'rec-1', role: 'RECEPTIONIST' };

describe('InPersonDeskService.registerWalkIn', () => {
  // 10:31 IST on a weekday; only the clock is faked (promises / timers run normally).
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-10-21T05:01:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'],
    });
  });
  afterEach(() => jest.useRealTimers());

  it('books the next free in-person slot of today at the receptionist location and checks it in', async () => {
    const w = build();
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out).toMatchObject({ result: 'CHECKED_IN', created: true });
    expect(w.visits.resolveReceptionistLocation).toHaveBeenCalledWith('rec-1', CLINIC);
    const [dto, userId, clinicId, role] = w.appointments.createAppointment.mock
      .calls[0] as unknown as [Record<string, unknown>, string, string, string];
    // 10:00 and 10:30 are already past at 10:31: the next free slot is 10:33.
    expect(dto).toMatchObject({
      patientId: 'pat-1',
      doctorId: 'doc-1',
      locationId: LOC,
      type: 'IN_PERSON',
      appointmentDate: '2026-10-21T10:33:00+05:30',
      metadata: { isWalkIn: true, bookingSource: 'WALK_IN' },
    });
    // The visit length is not sent: the booking service sets the clinic in-person length.
    expect(dto['duration']).toBeUndefined();
    expect(w.appointments.getDoctorAvailability).toHaveBeenCalledWith(
      'doc-1',
      '2026-10-21',
      CLINIC,
      'rec-1',
      LOC,
      'RECEPTIONIST',
      'IN_PERSON'
    );
    expect([userId, clinicId, role]).toEqual(['rec-1', CLINIC, 'RECEPTIONIST']);
    expect(w.checkIns.checkInManually).toHaveBeenCalledWith('apt-new', CLINIC, RECEPTION, {
      method: 'WALK_IN',
    });
    // The monthly in-person plan covers the visit (no per-visit fee): linked before check-in.
    expect(w.appointments.findActiveInPersonPlan).toHaveBeenCalledWith('pat-1', CLINIC);
    expect(w.appointments.linkInPersonPlan).toHaveBeenCalledWith(
      { subscriptionId: 'sub-1', patientUserId: 'user-1' },
      'apt-new',
      CLINIC
    );
  });

  it('refuses a walk-in without an active in-person plan: nothing booked, no check-in', async () => {
    const w = build({ plan: null });
    await expect(
      w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION)
    ).rejects.toThrow(
      'This patient has no active care plan. Sell a plan at the desk, or change the walk-in rule in clinic settings.'
    );
    expect(w.appointments.createAppointment).not.toHaveBeenCalled();
    expect(w.checkIns.checkInManually).not.toHaveBeenCalled();
  });

  it('ALLOW_FREE: a plan-less walk-in is booked and checked in with no bill', async () => {
    const w = build({
      plan: null,
      clinicSettings: { appointmentSettings: { walkInWithoutPlan: 'ALLOW_FREE' } },
    });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out).toMatchObject({
      result: 'CHECKED_IN',
      created: true,
      planWaiver: {
        policy: 'ALLOW_FREE',
        deskFee: null,
        invoiceId: null,
        label: 'No plan needed — free visit',
      },
    });
    expect(w.billing.createInvoice).not.toHaveBeenCalled();
    expect(w.appointments.linkInPersonPlan).not.toHaveBeenCalled();
    // The waiver is recorded on the visit before the check-in (which accepts it).
    const waiverWrite = w.writes.find(write => write['metadata']) as {
      metadata: { planWaiver: Record<string, unknown>; isWalkIn: boolean };
    };
    expect(waiverWrite.metadata).toMatchObject({
      isWalkIn: true,
      planWaiver: { policy: 'ALLOW_FREE', appliedBy: 'rec-1' },
    });
    expect(w.checkIns.checkInManually).toHaveBeenCalled();
  });

  it('ALLOW_WITH_DESK_FEE: raises one PENDING desk bill of the clinic walk-in fee', async () => {
    const w = build({
      plan: null,
      clinicSettings: {
        appointmentSettings: { walkInWithoutPlan: 'ALLOW_WITH_DESK_FEE', walkInDeskFee: 300 },
      },
    });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out.planWaiver).toEqual({
      policy: 'ALLOW_WITH_DESK_FEE',
      deskFee: 300,
      invoiceId: 'inv-desk-1',
      label: 'Desk fee ₹300 — collect at counter',
    });
    expect(w.billing.createInvoice).toHaveBeenCalledTimes(1);
    const [invoice] = w.billing.createInvoice.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(invoice).toMatchObject({
      userId: 'user-1',
      clinicId: CLINIC,
      amount: 300,
      billType: 'CONSULTATION',
      appointmentId: 'apt-new',
      description: 'Walk-in consultation — 21 Oct 2026',
      metadata: { appointmentType: 'IN_PERSON', payableAt: 'DESK' },
    });
    // A desk bill: no status override (PENDING) and no online-checkout expiry fields.
    expect(invoice['status']).toBeUndefined();
    expect(invoice['paymentExpiresAt']).toBeUndefined();
  });

  it('ALLOW_WITH_DESK_FEE without any fee configured: refused before anything is booked', async () => {
    const w = build({
      plan: null,
      clinicSettings: { appointmentSettings: { walkInWithoutPlan: 'ALLOW_WITH_DESK_FEE' } },
    });
    await expect(
      w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION)
    ).rejects.toThrow('walk-in desk fee');
    expect(w.appointments.createAppointment).not.toHaveBeenCalled();
  });

  it('ALLOW_WITH_DESK_FEE falls back to the clinic consultation fee', async () => {
    const w = build({
      plan: null,
      consultationFee: 450,
      clinicSettings: { appointmentSettings: { walkInWithoutPlan: 'ALLOW_WITH_DESK_FEE' } },
    });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out.planWaiver).toMatchObject({ deskFee: 450, invoiceId: 'inv-desk-1' });
  });

  it('cancels the booked visit when the plan cannot cover it', async () => {
    const w = build({ linkFails: true });
    await expect(
      w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION)
    ).rejects.toThrow('plan quota used up');
    expect(w.appointments.cancelAppointment).toHaveBeenCalledWith(
      'apt-new',
      expect.any(String),
      'rec-1',
      CLINIC,
      'RECEPTIONIST'
    );
    expect(w.checkIns.checkInManually).not.toHaveBeenCalled();
  });

  it('reuses an open visit already on the plan without linking again', async () => {
    const w = build({ openToday: { id: 'apt-open', subscriptionId: 'sub-1' } });
    await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(w.appointments.findActiveInPersonPlan).not.toHaveBeenCalled();
    expect(w.appointments.linkInPersonPlan).not.toHaveBeenCalled();
  });

  it('is idempotent: an open visit of the patient today at the desk is reused, nothing booked', async () => {
    const w = build({ openToday: { id: 'apt-open' } });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out.created).toBe(false);
    expect(w.appointments.createAppointment).not.toHaveBeenCalled();
    expect(w.checkIns.checkInManually).toHaveBeenCalledWith('apt-open', CLINIC, RECEPTION, {
      method: 'WALK_IN',
    });
  });

  it('takes the following free slot when the first one was booked meanwhile (409)', async () => {
    const w = build({
      createResults: ['conflict', { success: true, data: { id: 'apt-2' } }],
    });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out.created).toBe(true);
    const times = w.appointments.createAppointment.mock.calls.map(
      call => (call as unknown as [Record<string, unknown>])[0]['appointmentDate'] as string
    );
    expect(times).toEqual(['2026-10-21T10:33:00+05:30', '2026-10-21T10:36:00+05:30']);
    expect(w.checkIns.checkInManually).toHaveBeenCalledWith('apt-2', CLINIC, RECEPTION, {
      method: 'WALK_IN',
    });
  });

  it('moves on when another desk holds the slot lock (SCHEDULING_CONFLICT result)', async () => {
    const lockHeld = { success: false, error: 'SCHEDULING_CONFLICT', message: 'being booked' };
    const w = build({
      createResults: [lockHeld, lockHeld, { success: true, data: { id: 'apt-3' } }],
    });
    const out = await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    expect(out.created).toBe(true);
    const times = w.appointments.createAppointment.mock.calls.map(
      call => (call as unknown as [Record<string, unknown>])[0]['appointmentDate'] as string
    );
    expect(times).toEqual([
      '2026-10-21T10:33:00+05:30',
      '2026-10-21T10:36:00+05:30',
      '2026-10-21T11:00:00+05:30',
    ]);
    expect(w.checkIns.checkInManually).toHaveBeenCalledWith('apt-3', CLINIC, RECEPTION, {
      method: 'WALK_IN',
    });
  });

  it('409 (not 400) when every candidate slot collides; nothing checked in', async () => {
    const lockHeld = { success: false, error: 'SCHEDULING_CONFLICT', message: 'being booked' };
    const w = build({ createResults: [lockHeld, 'conflict', lockHeld] });
    const outcome = w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    await expect(outcome).rejects.toBeInstanceOf(ConflictException);
    await expect(outcome).rejects.toThrow('just taken at another desk');
    expect(w.appointments.createAppointment).toHaveBeenCalledTimes(3);
    expect(w.checkIns.checkInManually).not.toHaveBeenCalled();
  });

  it('a validation refusal is not retried and stays a 400', async () => {
    const w = build({
      createResults: [{ success: false, error: 'VALIDATION_ERROR', message: 'Clinic is closed' }],
    });
    const outcome = w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    await expect(outcome).rejects.toMatchObject({ status: 400 });
    expect(w.appointments.createAppointment).toHaveBeenCalledTimes(1);
  });

  it('is not limited to now / +1 / +2 min: a walk-in at 10:31 can get 13:00', async () => {
    const w = build({ freeSlots: ['09:00', '13:00', '13:03'] });
    await w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION);
    const [dto] = w.appointments.createAppointment.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(dto['appointmentDate']).toBe('2026-10-21T13:00:00+05:30');
  });

  it('409 offering the next free slot when today is full; nothing booked', async () => {
    const w = build({
      slotsByDate: { '2026-10-21': ['09:00', '10:30'], '2026-10-23': ['10:03', '10:00'] },
    });
    const failure = await w.service
      .registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    const body = (failure as ConflictException).getResponse() as Record<string, unknown>;
    expect(body['message']).toBe('No free slot left today. Next available: Fri 23 Oct, 10:00 AM.');
    expect(body['code']).toBe('WALK_IN_NO_SLOT_TODAY');
    expect(body['nextAvailable']).toEqual({
      date: '2026-10-23',
      time: '10:00',
      doctorId: 'doc-1',
      locationId: LOC,
    });
    expect(body['details']).toEqual({ nextAvailable: body['nextAvailable'] });
    expect(w.appointments.createAppointment).not.toHaveBeenCalled();
    expect(w.checkIns.checkInManually).not.toHaveBeenCalled();
  });

  it('409 with nextAvailable null when nothing is free in the next 14 days', async () => {
    const w = build({ slotsByDate: { '2026-10-21': ['09:00'] } });
    const failure = await w.service
      .registerWalkIn({ patientId: 'pat-1' }, CLINIC, RECEPTION)
      .catch((error: unknown) => error);
    const body = (failure as ConflictException).getResponse() as Record<string, unknown>;
    expect(body['message']).toContain('No free in-person slot is left today');
    expect(body['nextAvailable']).toBeNull();
    // Today + the weekdays of the next 14 days (weekends are never booked), nothing more.
    expect(w.appointments.getDoctorAvailability).toHaveBeenCalledTimes(11);
    expect(w.appointments.createAppointment).not.toHaveBeenCalled();
  });

  it('refuses roles other than the front desk', async () => {
    for (const role of ['PATIENT', 'DOCTOR', 'ASSISTANT_DOCTOR', 'PHARMACIST']) {
      const w = build();
      await expect(
        w.service.registerWalkIn({ patientId: 'pat-1' }, CLINIC, { userId: 'u', role })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('404s a patient of another clinic', async () => {
    const w = build({ patient: null });
    await expect(
      w.service.registerWalkIn({ patientId: 'pat-x' }, CLINIC, RECEPTION)
    ).rejects.toThrow('Patient not found in this clinic');
  });
});

describe('InPersonDeskService.undoNoShow', () => {
  it('a checked-in no-show goes back to CONFIRMED and into the live queue', async () => {
    const w = build();
    const out = await w.service.undoNoShow('apt-1', CLINIC, RECEPTION);
    expect(out).toMatchObject({
      result: 'RESTORED',
      alreadyRestored: false,
      restoredStatus: 'CONFIRMED',
    });
    // M4: only the status changes (token, arrival and check-in stay); the undo is recorded.
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]).toMatchObject({
      status: 'CONFIRMED',
      metadata: { noShowUndo: { restoredStatus: 'CONFIRMED', undoneBy: RECEPTION.userId } },
    });
    expect(Object.keys(w.writes[0] as object).sort()).toEqual(['metadata', 'status']);
    expect(w.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      { appointmentId: 'apt-1', locationId: LOC, patientId: 'pat-1' },
      CLINIC,
      { actor: RECEPTION, presence: 'skip' }
    );
    expect(w.cache.invalidateAppointmentCache).toHaveBeenCalled();
  });

  it('a no-show that never arrived goes back to SCHEDULED and is not queued', async () => {
    const w = build({ appointment: row({ checkedInAt: null }) });
    const out = await w.service.undoNoShow('apt-1', CLINIC, RECEPTION);
    expect(out.restoredStatus).toBe('SCHEDULED');
    expect(w.checkInLocations.processCheckIn).not.toHaveBeenCalled();
  });

  it('a repeat click is a no-op', async () => {
    const w = build({
      appointment: row({
        status: 'CONFIRMED',
        metadata: { noShowUndo: { restoredStatus: 'CONFIRMED', undoneAt: 'x', undoneBy: 'u' } },
      }),
    });
    const out = await w.service.undoNoShow('apt-1', CLINIC, RECEPTION);
    expect(out).toMatchObject({ alreadyRestored: true, restoredStatus: 'CONFIRMED' });
    expect(w.writes).toEqual([]);
  });

  it('an undo on a visit that was never a no-show is 409 (contract 18.7, L3)', async () => {
    for (const status of ['CONFIRMED', 'SCHEDULED']) {
      const w = build({ appointment: row({ status }) });
      await expect(w.service.undoNoShow('apt-1', CLINIC, RECEPTION)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(w.writes).toEqual([]);
    }
  });

  it('restores the status recorded when the no-show was marked (M4)', async () => {
    const w = build({
      appointment: row({
        checkedInAt: null,
        metadata: { noShowMark: { previousStatus: 'CONFIRMED', markedAt: 'x' } },
      }),
    });
    const out = await w.service.undoNoShow('apt-1', CLINIC, RECEPTION);
    expect(out.restoredStatus).toBe('CONFIRMED');
  });

  it('only on the visit day, and only for a no-show', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const past = build({
      appointment: row({ date: new Date(`${formatDateKeyInIST(yesterday)}T00:00:00.000Z`) }),
    });
    await expect(past.service.undoNoShow('apt-1', CLINIC, RECEPTION)).rejects.toBeInstanceOf(
      BadRequestException
    );
    const done = build({ appointment: row({ status: 'COMPLETED' }) });
    await expect(done.service.undoNoShow('apt-1', CLINIC, RECEPTION)).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('PATCH status helper only handles NO_SHOW -> CONFIRMED / SCHEDULED', async () => {
    const w = build();
    expect(
      await w.service.undoNoShowIfApplicable('apt-1', 'IN_PROGRESS', CLINIC, RECEPTION)
    ).toBeNull();
    const undone = await w.service.undoNoShowIfApplicable('apt-1', 'CONFIRMED', CLINIC, RECEPTION);
    expect(undone?.restoredStatus).toBe('CONFIRMED');
    const other = build({ appointment: row({ status: 'SCHEDULED' }) });
    expect(
      await other.service.undoNoShowIfApplicable('apt-1', 'CONFIRMED', CLINIC, RECEPTION)
    ).toBeNull();
  });

  it('patients and pharmacists cannot undo a no-show', async () => {
    for (const role of ['PATIENT', 'PHARMACIST']) {
      const w = build();
      await expect(
        w.service.undoNoShow('apt-1', CLINIC, { userId: 'u', role })
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
