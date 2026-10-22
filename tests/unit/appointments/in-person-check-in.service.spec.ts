/**
 * InPersonCheckInService - the ONE check-in used by the patient QR scan and the receptionist's
 * one-click manual check-in. Collaborators are fakes; the rules come from the real pure util.
 */
import {
  InPersonCheckInError,
  InPersonCheckInService,
} from '@services/appointments/in-person/in-person-check-in.service';
import type { InPersonAppointmentRow } from '@services/appointments/in-person/in-person-visit.service';
import { formatDateKeyInIST } from '@utils/date-time.util';

const CLINIC = 'clinic-1';
const LOC_A = 'loc-a';
const LOC_B = 'loc-b';

function slotAround(now: Date, minutesFromNow: number): { date: Date; time: string } {
  const start = new Date(now.getTime() + minutesFromNow * 60_000);
  const ist = new Date(start.getTime() + 330 * 60_000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return { date: new Date(`${formatDateKeyInIST(start)}T00:00:00.000Z`), time: `${hh}:${mm}` };
}

function row(over: Partial<InPersonAppointmentRow> = {}): InPersonAppointmentRow {
  return {
    id: 'apt-1',
    clinicId: CLINIC,
    patientId: 'pat-1',
    doctorId: 'doc-1',
    userId: 'user-1',
    familyMemberId: null,
    locationId: LOC_A,
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    ...slotAround(new Date(), 10),
    duration: 30,
    priority: 'NORMAL',
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    patient: { user: { name: 'Asha Patil', firstName: null, lastName: null } },
    doctor: { user: { name: 'Dr. Deshmukh', firstName: null, lastName: null } },
    location: { name: 'Kothrud' },
    ...over,
  };
}

function build(bookings: InPersonAppointmentRow[]) {
  const checkInLocations = {
    getLocationById: jest.fn(async (id: string) => ({
      id: 'qr-a',
      clinicId: CLINIC,
      locationId: id === 'qr-b' ? LOC_B : LOC_A,
      locationName: 'Kothrud',
      qrCode: 'CODE-A',
      qrVersion: 1,
      isActive: true,
    })),
    getLocationByQRCode: jest.fn(async (code: string) => {
      if (code !== 'CODE-A' && code !== 'CODE-B') {
        const { NotFoundException } = await import('@nestjs/common');
        throw new NotFoundException('no');
      }
      return {
        id: code === 'CODE-B' ? 'qr-b' : 'qr-a',
        clinicId: CLINIC,
        locationId: code === 'CODE-B' ? LOC_B : LOC_A,
        locationName: 'X',
        qrCode: code,
        qrVersion: 1,
        isActive: true,
      };
    }),
    processCheckIn: jest.fn(async () => ({ id: 'ci-1', alreadyCheckedIn: false })),
  };
  const visits = {
    findPatientBookingsToday: jest.fn(async () => bookings),
    loadForActor: jest.fn(async (id: string) => {
      const found = bookings.find(b => b.id === id);
      if (!found) throw new Error('not found');
      return found;
    }),
    toVisits: jest.fn(async (rows: InPersonAppointmentRow[]) =>
      rows.map(r => ({ appointmentId: r.id, patientName: 'Asha Patil', token: 'K-014' }))
    ),
  };
  const locationQr = { inspectLocationQR: jest.fn(() => 'VALID') };
  const events = { emit: jest.fn(async () => undefined) };
  const logging = { log: jest.fn(async () => undefined) };
  const checkInLog = { recordAttempt: jest.fn(async () => undefined) };
  const service = new InPersonCheckInService(
    checkInLocations as never,
    visits as never,
    locationQr as never,
    events as never,
    logging as never,
    checkInLog as never
  );
  return { service, checkInLocations, visits, events, checkInLog, locationQr };
}

const PATIENT = { userId: 'user-1', role: 'PATIENT' };
/** A device position (the fake locations have no geofence, so it is accepted unverified). */
const HERE = { lat: 18.5204, lng: 73.8567 };
const RECEPTION = { userId: 'rec-1', role: 'RECEPTIONIST' };

describe('InPersonCheckInService - patient QR', () => {
  it('checks in at the booked location, logs SUCCESS and emits the events', async () => {
    const world = build([row()]);
    // Typed desk code: the position is required and verified by the service itself.
    const result = await world.service.checkIn(
      { qrCode: 'CODE-A', coordinates: HERE },
      CLINIC,
      PATIENT
    );

    expect(result).toMatchObject({ result: 'CHECKED_IN', alreadyCheckedIn: false });
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'apt-1', locationId: 'qr-a' }),
      CLINIC,
      { actor: PATIENT, presence: 'skip' }
    );
    expect(world.events.emit).toHaveBeenCalledWith('appointment.checked_in', expect.any(Object));
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'QR', outcome: 'SUCCESS', tokenLabel: 'K-014' })
    );
  });

  it('WRONG_LOCATION is refused, logged as a failed attempt, and nothing is written', async () => {
    const world = build([row()]);
    await expect(
      world.service.checkIn({ qrCode: 'CODE-B' }, CLINIC, PATIENT)
    ).rejects.toMatchObject({
      code: 'WRONG_LOCATION',
    });
    expect(world.checkInLocations.processCheckIn).not.toHaveBeenCalled();
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILED', failureReason: 'WRONG_LOCATION', method: 'QR' })
    );
  });

  it('TOO_EARLY and EXPIRED windows are logged with their reasons', async () => {
    const early = build([row({ ...slotAround(new Date(), 120) })]);
    await expect(
      early.service.checkIn({ qrCode: 'CODE-A' }, CLINIC, PATIENT)
    ).rejects.toMatchObject({
      code: 'TOO_EARLY',
    });
    expect(early.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: 'TOO_EARLY' })
    );

    const late = build([row({ ...slotAround(new Date(), -45), duration: 15 })]);
    await expect(late.service.checkIn({ qrCode: 'CODE-A' }, CLINIC, PATIENT)).rejects.toMatchObject(
      {
        code: 'EXPIRED',
      }
    );
    expect(late.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ failureReason: 'TOO_LATE' })
    );
  });

  it('NOT_BOOKED without a booking today (404)', async () => {
    const world = build([]);
    const error = await world.service
      .checkIn({ qrCode: 'CODE-A' }, CLINIC, PATIENT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InPersonCheckInError);
    expect((error as InPersonCheckInError).getStatus()).toBe(404);
  });

  it('INVALID_QR for an unknown code, EXPIRED_QR for a replaced poster', async () => {
    const world = build([row()]);
    await expect(world.service.checkIn({ qrCode: 'NOPE' }, CLINIC, PATIENT)).rejects.toMatchObject({
      code: 'INVALID_QR',
    });
    world.locationQr.inspectLocationQR.mockReturnValue('REPLACED');
    const poster = JSON.stringify({ locationId: 'qr-a', type: 'LOCATION_CHECK_IN' });
    await expect(world.service.checkIn({ qrCode: poster }, CLINIC, PATIENT)).rejects.toMatchObject({
      code: 'EXPIRED_QR',
    });
  });

  it('is idempotent: an arrival already recorded answers alreadyCheckedIn without a new log row', async () => {
    const world = build([row({ status: 'CONFIRMED', checkedInAt: new Date() })]);
    world.checkInLocations.processCheckIn.mockResolvedValueOnce({
      id: 'ci-1',
      alreadyCheckedIn: true,
    } as never);
    const result = await world.service.checkIn(
      { qrCode: 'CODE-A', coordinates: HERE },
      CLINIC,
      PATIENT
    );
    expect(result).toMatchObject({ result: 'CHECKED_IN', alreadyCheckedIn: true });
    expect(world.events.emit).not.toHaveBeenCalled();
    expect(world.checkInLog.recordAttempt).not.toHaveBeenCalled();
  });

  it('asks the patient to choose between two open bookings at the location', async () => {
    const world = build([row({ id: 'a' }), row({ id: 'b' })]);
    const result = await world.service.checkIn({ qrCode: 'CODE-A' }, CLINIC, PATIENT);
    expect(result.result).toBe('SELECT_APPOINTMENT');
  });
});

describe('InPersonCheckInService - reception one-click', () => {
  it('uses the SAME processCheckIn, without presence, and logs MANUAL', async () => {
    const world = build([row()]);
    const result = await world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION);
    expect(result.result).toBe('CHECKED_IN');
    expect(world.checkInLocations.processCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: 'apt-1', locationId: LOC_A }),
      CLINIC,
      { actor: RECEPTION, presence: 'skip' }
    );
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'MANUAL', outcome: 'SUCCESS' })
    );
  });

  it('works outside the patient window on the same day', async () => {
    const world = build([row({ ...slotAround(new Date(), -100), duration: 15 })]);
    // skip in the 100 minutes after IST midnight (the slot would be yesterday)
    if (formatDateKeyInIST(new Date(Date.now() - 100 * 60_000)) !== formatDateKeyInIST(new Date()))
      return;
    await expect(
      world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).resolves.toMatchObject({
      result: 'CHECKED_IN',
    });
  });

  it('reception never scans a QR', async () => {
    const world = build([row()]);
    await expect(
      world.service.checkIn({ qrCode: 'CODE-A', appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).rejects.toMatchObject({ code: 'QR_NOT_FOR_STAFF' });
    expect(world.checkInLocations.processCheckIn).not.toHaveBeenCalled();
  });

  it('refuses another location (access check fails) and logs the failure', async () => {
    const world = build([row()]);
    const { ForbiddenException } = await import('@nestjs/common');
    world.visits.loadForActor.mockRejectedValueOnce(new ForbiddenException('other location'));
    await expect(
      world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(world.checkInLog.recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'MANUAL', outcome: 'FAILED' })
    );
  });

  it('refuses a cancelled visit and another day', async () => {
    const cancelled = build([row({ status: 'CANCELLED' })]);
    await expect(
      cancelled.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).rejects.toMatchObject({ code: 'NOT_BOOKED' });

    const tomorrow = build([row({ date: new Date(Date.now() + 2 * 86_400_000) })]);
    await expect(
      tomorrow.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, RECEPTION)
    ).rejects.toMatchObject({ code: 'NOT_TODAY' });
  });

  it('assistant doctor / doctor cannot check anyone in', async () => {
    const world = build([row()]);
    await expect(
      world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, {
        userId: 'a',
        role: 'ASSISTANT_DOCTOR',
      })
    ).rejects.toThrow(/Only patients/);
    await expect(
      world.service.checkIn({ appointmentId: 'apt-1' }, CLINIC, { userId: 'd', role: 'DOCTOR' })
    ).rejects.toThrow(/Only patients/);
  });
});
