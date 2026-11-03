import { describe, expect, it } from '@jest/globals';
import { computeQueuePlace, computeQueuePlaces } from '@utils/in-person-flow.util';
import {
  glanceDoctorQueue,
  queueNotifyKey,
  queueNotifyMessage,
  selectQueueNotifications,
  thresholdFor,
} from '@services/appointments/in-person/queue-notify.util';
import { parseDeskPaging } from '@services/appointments/in-person/in-person-visit.service';

const line = [
  { appointmentId: 'a0', status: 'IN_PROGRESS', tokenNumber: 1, tokenLabel: 'K-001' },
  { appointmentId: 'a1', status: 'WAITING', tokenNumber: 2, tokenLabel: 'K-002' },
  { appointmentId: 'gone', status: 'COMPLETED', tokenNumber: 3 },
  { appointmentId: 'a2', status: 'WAITING', tokenNumber: 4, tokenLabel: 'K-004' },
  { appointmentId: 'a3', status: 'CONFIRMED', tokenNumber: 5 },
  { appointmentId: 'a1', status: 'WAITING', tokenNumber: 2 },
  { appointmentId: 'a4', status: 'WAITING', tokenNumber: 6 },
];

describe('computeQueuePlaces (desk board in one pass, M6)', () => {
  it('answers exactly what computeQueuePlace answers for every appointment', () => {
    const places = computeQueuePlaces(line, 10);
    for (const id of ['a0', 'a1', 'a2', 'a3', 'a4', 'gone', 'missing']) {
      expect(places.get(id) ?? null).toEqual(computeQueuePlace(line, id, 10));
    }
  });
});

describe('queue position notifications', () => {
  it('thresholds: next at 0 ahead, near at 1..2 ahead, nothing further back', () => {
    expect(thresholdFor(0)).toBe('NEXT');
    expect(thresholdFor(1)).toBe('NEAR');
    expect(thresholdFor(2)).toBe('NEAR');
    expect(thresholdFor(3)).toBeNull();
  });

  it('selects the waiting patients per doctor and location line', () => {
    const entries = [
      ...line.map(e => ({
        ...e,
        doctorId: 'd-1',
        locationId: 'loc-1',
        patientId: `p-${e.appointmentId}`,
      })),
      {
        appointmentId: 'b1',
        status: 'WAITING',
        doctorId: 'd-2',
        locationId: 'loc-1',
        patientId: 'p-b1',
      },
    ];
    const due = selectQueueNotifications(entries, 10);
    const byId = new Map(due.map(d => [d.appointmentId, d]));
    expect(byId.get('a1')).toMatchObject({ threshold: 'NEXT', peopleAhead: 0, token: 'K-002' });
    expect(byId.get('a2')).toMatchObject({ threshold: 'NEAR', peopleAhead: 1 });
    expect(byId.get('a3')).toMatchObject({ threshold: 'NEAR', peopleAhead: 2 });
    expect(byId.has('a4')).toBe(false);
    expect(byId.has('a0')).toBe(false); // with the doctor
    expect(byId.get('b1')).toMatchObject({ threshold: 'NEXT', patientId: 'p-b1' });
    // The duplicate a1 line is notified once.
    expect(due.filter(d => d.appointmentId === 'a1')).toHaveLength(1);
  });

  it('debounce keys are per appointment and threshold; messages read naturally', () => {
    expect(queueNotifyKey('a1', 'NEXT')).not.toBe(queueNotifyKey('a1', 'NEAR'));
    expect(
      queueNotifyMessage({
        appointmentId: 'a',
        patientId: 'p',
        threshold: 'NEXT',
        peopleAhead: 0,
        token: 'K-002',
      }).title
    ).toBe("You're next");
    expect(
      queueNotifyMessage({
        appointmentId: 'a',
        patientId: 'p',
        threshold: 'NEAR',
        peopleAhead: 2,
        token: null,
      }).body
    ).toContain('2 patients ahead');
  });
});

describe('desk board paging (?page=&limit=)', () => {
  it('no page keeps the whole-day board; a page is bounded', () => {
    expect(parseDeskPaging(undefined, undefined)).toBeNull();
    expect(parseDeskPaging('0', '100')).toBeNull();
    expect(parseDeskPaging('2', '100')).toEqual({ page: 2, limit: 100, offset: 100 });
    expect(parseDeskPaging('1', '99999')).toEqual({ page: 1, limit: 500, offset: 0 });
    expect(parseDeskPaging('1', undefined)).toEqual({ page: 1, limit: 100, offset: 0 });
  });
});

describe('doctor dashboard "next patient" from the live queue (B11)', () => {
  it('next = first waiting entry in serving order, not the earliest slot', () => {
    const glance = glanceDoctorQueue([
      { appointmentId: 'a0', status: 'IN_PROGRESS', tokenNumber: 1, tokenLabel: 'K-001' },
      { appointmentId: 'gone', status: 'COMPLETED', tokenNumber: 2 },
      {
        appointmentId: 'a5',
        status: 'WAITING',
        tokenNumber: 5,
        tokenLabel: 'K-005',
        patientId: 'p5',
      },
      { appointmentId: 'a3', status: 'WAITING', tokenNumber: 3, tokenLabel: 'K-003' },
    ]);
    expect(glance).toEqual({
      source: 'operational-queue',
      inProgressAppointmentId: 'a0',
      nextAppointmentId: 'a5',
      nextToken: 'K-005',
      nextPatientId: 'p5',
      waiting: 2,
    });
  });

  it('an empty queue has no next patient', () => {
    expect(glanceDoctorQueue([])).toMatchObject({ nextAppointmentId: null, waiting: 0 });
  });
});
