/**
 * Builds a real AppointmentsService on top of FakeDb with plain-object collaborators.
 * Import it only from specs that register the usual jest.mock() header first.
 */
import { jest, expect } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { AppointmentsService } from '@services/appointments/appointments.service';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { FakeDb, createCacheStub, createErrors, createLoggingStub, type Row } from './test-helpers';

export type { Row };

export const CLINIC = 'clinic-1';
export const OTHER_CLINIC = 'clinic-2';

/**
 * The fixture visit is always a week ahead of the clock (real or faked), so the time-window
 * rules (video join window, 5-hour reschedule window) see a visit that has not started yet
 * whatever day the suite runs on; specs that need a past or far-future visit override `date`.
 */
export const FIXTURE_DAYS_AHEAD = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' (IST calendar day) of the fixture visit, `daysAhead` days from now. */
export function fixtureDateKey(daysAhead: number = FIXTURE_DAYS_AHEAD): string {
  return formatDateKeyInIST(new Date(Date.now() + daysAhead * MS_PER_DAY));
}

/** IST midnight of the fixture day, the way the booking flow stores `date`. */
export function fixtureDate(daysAhead: number = FIXTURE_DAYS_AHEAD): Date {
  return new Date(`${fixtureDateKey(daysAhead)}T00:00:00.000+05:30`);
}

/** The instant of an IST wall-clock time ('HH:mm') on the fixture day. */
export function fixtureInstant(time: string, daysAhead: number = FIXTURE_DAYS_AHEAD): Date {
  return new Date(`${fixtureDateKey(daysAhead)}T${time}:00.000+05:30`);
}

export function appointmentRow(overrides: Row = {}): Row {
  return {
    id: 'appt-1',
    clinicId: CLINIC,
    patientId: 'patient-1',
    userId: 'user-patient',
    doctorId: 'doctor-1',
    type: 'IN_PERSON',
    status: 'IN_PROGRESS',
    locationId: 'loc-1',
    date: fixtureDate(),
    time: '10:00',
    duration: 30,
    metadata: {},
    completedAt: null,
    // Checked in half an hour before the 10:00 slot.
    checkedInAt: fixtureInstant('09:30'),
    doctor: { id: 'doctor-1', userId: 'user-doctor' },
    payment: null,
    ...overrides,
  };
}

export function paidVideoRow(overrides: Row = {}): Row {
  return appointmentRow({
    type: 'VIDEO_CALL',
    locationId: null,
    payment: { status: 'COMPLETED', invoice: null },
    ...overrides,
  });
}

export async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

export function buildHarness(options: { db?: FakeDb } = {}) {
  const db = options.db ?? new FakeDb();
  const cache = createCacheStub();
  const logging = createLoggingStub();
  const errors = createErrors();
  const events = {
    emit: jest.fn(async (..._args: unknown[]) => undefined),
    emitEnterprise: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const confirmationPlugin = {
    process: jest.fn(async (payload: Row) => ({
      success: true,
      appointmentId: payload['appointmentId'],
    })),
  };
  const queue = {
    removePatientFromQueue: jest.fn(async (..._args: unknown[]) => undefined),
    checkIn: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const core = {
    getDoctorAvailability: jest.fn(async (..._args: unknown[]) => ({
      availableSlots: ['10:00', '11:00', '12:00'],
    })),
    updateAppointment: jest.fn(async (..._args: unknown[]) => ({ success: true, data: {} })),
    // The slice of the core list query that findUserAppointmentsByLocation relies on.
    getAppointments: jest.fn(
      async (filters: Row, _context: Row, _page: number, _limit: number) => ({
        success: true,
        data: {
          appointments: db
            .rows('appointment')
            .filter(
              row =>
                row['clinicId'] === filters['clinicId'] &&
                row['patientId'] === filters['patientId'] &&
                row['locationId'] === filters['locationId'] &&
                row['status'] === filters['status']
            ),
        },
      })
    ),
  };
  const rbac = {
    checkPermission: jest.fn(async (..._args: unknown[]) => ({ hasPermission: true })),
  };
  const checkInPlugin = {
    process: jest.fn(async (..._args: unknown[]) => ({ success: true })),
  };
  const reminders = { rescheduleReminder: jest.fn(async (..._args: unknown[]) => undefined) };
  const config = { getEnv: jest.fn((_key: string, fallback: string) => fallback) };

  const noop = {} as never;
  const service = new AppointmentsService(
    core as never, // coreAppointmentService
    noop, // conflictResolutionService
    noop, // workflowEngine
    noop, // businessRules
    noop, // pluginRegistry
    noop, // pluginManager
    checkInPlugin as never,
    noop, // checkInService
    noop, // clinicNotificationPlugin
    confirmationPlugin as never,
    noop, // clinicLocationPlugin
    noop, // clinicFollowUpPlugin
    reminders as never,
    noop, // clinicVideoPlugin
    logging as never,
    cache as never,
    noop, // queueService
    queue as never,
    events as never,
    config as never,
    db as never,
    noop, // qrService
    noop, // authService
    noop, // whatsAppService
    noop, // notificationPreferenceService
    errors as never,
    rbac as never,
    noop // billingService
  );

  return {
    service,
    db,
    cache,
    logging,
    errors,
    events,
    confirmationPlugin,
    checkInPlugin,
    queue,
    core,
    rbac,
  };
}
