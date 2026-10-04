/**
 * A real CheckInLocationService on FakeDb for the check-in specs that need more control than the
 * original spec's builder: a pluggable queue (stub or the real AppointmentQueueService), a
 * pluggable cache, a configurable geofence centre and the usual single-location clinic.
 * Import it only from specs that register the usual jest.mock() header first.
 */
import { jest } from '@jest/globals';
import { CheckInLocationService } from '@services/appointments/plugins/therapy/check-in-location.service';
import { FakeDb, createCacheStub, createLoggingStub, type Row } from './test-helpers';
import { istSlot } from './check-in-time-helpers';

export const CLINIC = 'clinic-1';
export const OTHER_CLINIC = 'clinic-2';
export const CLINIC_LAT = 19.076;
export const CLINIC_LNG = 72.8777;
const METERS_PER_DEGREE_LAT = 111_194.9;

/** A position `meters` due north of the clinic. */
export function northOfClinic(meters: number): { lat: number; lng: number } {
  return { lat: CLINIC_LAT + meters / METERS_PER_DEGREE_LAT, lng: CLINIC_LNG };
}

export const PATIENT_ACTOR = { userId: 'user-patient', role: 'PATIENT' };
export const RECEPTIONIST_ACTOR = { userId: 'user-reception', role: 'RECEPTIONIST' };
export const DOCTOR_ACTOR = { userId: 'user-doctor', role: 'DOCTOR' };

/** The queue service as the check-in code sees it, with the real "already queued" error. */
export function createStubQueue() {
  const queued = new Set<string>();
  const queue = {
    checkIn: jest.fn(async (entry: { appointmentId: string }, _domain: string) => {
      if (queued.has(entry.appointmentId)) {
        throw new Error('Appointment arrival is already confirmed');
      }
      queued.add(entry.appointmentId);
      return { success: true };
    }),
    getPatientQueuePosition: jest.fn(async (..._args: unknown[]) => ({
      position: 1,
      totalInQueue: 1,
      estimatedWaitTime: 5,
    })),
  };
  return { queue, queued };
}

export interface CheckInWorldOptions<C extends object> {
  geofenceCoordinates?: unknown;
  locationRadius?: number;
  /** Replaces the stub queue, for example with the real AppointmentQueueService. */
  queue?: object;
  /** Replaces the default cache stub (for example with FakeQueueCache + the real queue service). */
  cache?: C;
}

export function buildCheckInServiceWorld<C extends object = ReturnType<typeof createCacheStub>>(
  options: CheckInWorldOptions<C> = {}
) {
  const db = new FakeDb();
  const cache = (options.cache ?? createCacheStub()) as C;
  const logging = createLoggingStub();
  const stub = createStubQueue();
  // Typed as the stub so specs can use its jest mock API; a custom queue replaces it at runtime.
  const queue = (options.queue ?? stub.queue) as typeof stub.queue;

  const clinicLocation = { id: 'loc-1', clinicId: CLINIC };
  const locationCache = {
    getLocation: jest.fn(async (..._args: unknown[]) => clinicLocation),
    invalidateLocation: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const clinicLocationService = {
    getClinicLocationById: jest.fn(async (..._args: unknown[]) => clinicLocation),
  };

  const service = new CheckInLocationService(
    db as never,
    cache as never,
    logging as never,
    queue as never,
    locationCache as never,
    clinicLocationService as never
  );

  db.insert('patient', { id: 'patient-1', userId: 'user-patient' });
  db.insert('patient', { id: 'patient-2', userId: 'user-other' });
  db.insert('clinicLocation', { id: 'loc-1', clinicId: CLINIC, isActive: true, deletedAt: null });
  db.insert('checkInLocation', {
    id: 'cil-1',
    clinicId: CLINIC,
    locationId: 'loc-1',
    locationName: 'Main Reception',
    isActive: true,
    qrCode: 'CHK-MAIN',
    coordinates:
      options.geofenceCoordinates !== undefined
        ? options.geofenceCoordinates
        : { lat: CLINIC_LAT, lng: CLINIC_LNG },
    radius: options.locationRadius ?? 300,
  });
  db.findSubscriptionByIdSafe.mockImplementation(async () => ({
    id: 'sub-1',
    clinicId: CLINIC,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  }));

  return { service, db, cache, logging, queue, stub, queued: stub.queued, locationCache };
}

export type CheckInServiceWorld<C extends object = ReturnType<typeof createCacheStub>> = ReturnType<
  typeof buildCheckInServiceWorld<C>
>;

/** An in-person appointment starting right now (call it after the clock is pinned). */
export function inPersonRow(overrides: Row = {}): Row {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    patientId: 'patient-1',
    userId: 'user-patient',
    doctorId: 'doctor-1',
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    locationId: 'loc-1',
    checkedInAt: null,
    subscriptionId: 'sub-1',
    isSubscriptionBased: true,
    ...istSlot(0),
    ...overrides,
  };
}

export function checkInInput(overrides: Row = {}) {
  return {
    appointmentId: 'appt-1',
    locationId: 'loc-1',
    patientId: 'patient-1',
    ...overrides,
  } as Parameters<CheckInLocationService['processCheckIn']>[0];
}
