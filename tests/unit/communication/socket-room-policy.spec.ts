import { describe, expect, it } from '@jest/globals';
import {
  buildSlimSocketPayload,
  canJoinRoom,
  determineTargetRooms,
  isStaffRole,
  resolveUserRooms,
  summarizeEvent,
} from '../../../src/libs/communication/channels/socket/socket-room-policy';
import {
  SOCKET_RELAY_CHANNEL,
  parseSocketRelayMessage,
} from '../../../src/libs/communication/channels/socket/socket-relay.util';

const envelope = (eventType: string, extra: Record<string, unknown>) => ({
  eventId: 'evt-1',
  eventType,
  category: 'SYSTEM',
  priority: 'NORMAL',
  timestamp: '2026-10-22T05:00:00.000Z',
  source: 'EventService',
  version: '1.0.0',
  ...extra,
});

describe('room selection by role', () => {
  it('puts staff into the clinic room and their role room', () => {
    const rooms = resolveUserRooms({ userId: 'u-rec', clinicId: 'CL1', role: 'RECEPTIONIST' });
    expect(rooms).toEqual(['user:u-rec', 'clinic:CL1', 'clinic:CL1:role:RECEPTIONIST']);
  });

  it('never puts a patient into the clinic-wide or role rooms', () => {
    const patient = { userId: 'u-pat', clinicId: 'CL1', role: 'PATIENT' };
    const rooms = resolveUserRooms(patient);
    expect(rooms).toEqual(['user:u-pat', 'clinic:CL1:public']);
    expect(canJoinRoom('clinic:CL1', patient)).toBe(false);
    expect(canJoinRoom('clinic:CL1:role:PATIENT', patient)).toBe(false);
    expect(canJoinRoom('user:u-other', patient)).toBe(false);
    expect(canJoinRoom('user:u-pat', patient)).toBe(true);
  });

  it('treats a missing or unknown role as non-staff', () => {
    expect(isStaffRole(undefined)).toBe(false);
    expect(isStaffRole('HACKER')).toBe(false);
    expect(isStaffRole('PATIENT')).toBe(false);
    expect(isStaffRole('DOCTOR')).toBe(true);
    expect(resolveUserRooms({ userId: 'u1', clinicId: 'CL1' })).toEqual([
      'user:u1',
      'clinic:CL1:public',
    ]);
  });

  it('does not let staff join another clinic', () => {
    const doctor = { userId: 'u-doc', clinicId: 'CL1', role: 'DOCTOR' };
    expect(canJoinRoom('clinic:CL2', doctor)).toBe(false);
    expect(canJoinRoom('clinic:CL1', doctor)).toBe(true);
  });

  it('returns no rooms without an identity', () => {
    expect(resolveUserRooms(undefined)).toEqual([]);
    expect(canJoinRoom('user:x', null)).toBe(false);
  });
});

describe('summarizeEvent + slim payload', () => {
  const checkedIn = envelope('appointment.checked_in', {
    clinicId: 'CL1',
    userId: 'u-rec',
    payload: {
      appointmentId: 'apt-1',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      locationId: 'loc-1',
      status: 'CONFIRMED',
      notes: 'patient has chest pain',
      appointment: {
        id: 'apt-1',
        status: 'CONFIRMED',
        patient: { userId: 'u-pat', firstName: 'Asha', phone: '+919999999999' },
        doctor: { firstName: 'Dr' },
      },
    },
  });

  it('keeps only ids, status and version/timestamp', () => {
    const summary = summarizeEvent(checkedIn);
    const data = buildSlimSocketPayload('appointment.checked_in', summary, 'now');
    expect(data).toEqual({
      eventType: 'appointment.checked_in',
      timestamp: '2026-10-22T05:00:00.000Z',
      eventId: 'evt-1',
      version: '1.0.0',
      clinicId: 'CL1',
      userId: 'u-rec',
      appointmentId: 'apt-1',
      patientId: 'pat-1',
      doctorId: 'doc-1',
      locationId: 'loc-1',
      status: 'CONFIRMED',
    });
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('Asha');
    expect(serialized).not.toContain('+919999999999');
    expect(serialized).not.toContain('chest pain');
    // Routing-only id is not sent to clients.
    expect(serialized).not.toContain('u-pat');
  });

  it('finds the patient user id for routing', () => {
    expect(summarizeEvent(checkedIn).ids.patientUserId).toBe('u-pat');
  });

  it('reads ids nested in payload.appointment / payment when absent at the top', () => {
    const summary = summarizeEvent(
      envelope('payment.completed', {
        payload: {
          appointment: { id: 'apt-9', clinicId: 'CL9', patientId: 'pat-9' },
          payment: { id: 'pay-9', status: 'COMPLETED', amount: 1250 },
        },
      })
    );
    expect(summary.ids).toMatchObject({
      appointmentId: 'apt-9',
      clinicId: 'CL9',
      patientId: 'pat-9',
      paymentId: 'pay-9',
    });
    expect(summary.paymentStatus).toBe('COMPLETED');
    expect(
      JSON.stringify(buildSlimSocketPayload('payment.completed', summary, 'now'))
    ).not.toContain('1250');
  });

  it('keeps queue position numbers for the patient', () => {
    const summary = summarizeEvent(
      envelope('appointment.queue.position.updated', {
        payload: { appointmentId: 'apt-1', position: 3, totalInQueue: 7, estimatedWaitTime: 20 },
      })
    );
    const data = buildSlimSocketPayload('appointment.queue.position.updated', summary, 'now');
    expect(data).toMatchObject({ position: 3, totalInQueue: 7, estimatedWaitTime: 20 });
  });

  it('ignores values that are not ids (free text, objects)', () => {
    const summary = summarizeEvent(
      envelope('appointment.updated', {
        payload: { clinicId: 'not an id with spaces', doctorId: { id: 'x' } },
      })
    );
    expect(summary.ids.clinicId).toBeUndefined();
    expect(summary.ids.doctorId).toBeUndefined();
  });

  it('handles plain (non-envelope) payloads', () => {
    const summary = summarizeEvent({
      appointmentId: 'apt-2',
      clinicId: 'CL2',
      status: 'CANCELLED',
    });
    expect(summary.ids).toMatchObject({ appointmentId: 'apt-2', clinicId: 'CL2' });
    expect(summary.status).toBe('CANCELLED');
  });
});

describe('determineTargetRooms', () => {
  it('sends appointment events to staff (clinic room) and the patient user room only', () => {
    const rooms = determineTargetRooms('appointment.checked_in', {
      clinicId: 'CL1',
      appointmentId: 'apt-1',
      patientUserId: 'u-pat',
    });
    expect(rooms).toEqual(['user:u-pat', 'clinic:CL1', 'appointment:apt-1']);
    expect(rooms).not.toContain('clinic:CL1:public');
    // Role rooms are subsets of the staff-only clinic room: not targeted separately, so a
    // staff socket in both never gets the event twice from the union emit.
    expect(rooms.some(room => room.includes(':role:'))).toBe(false);
  });

  it('delivers catalog events to the patient-facing public room too', () => {
    const rooms = determineTargetRooms('doctor.availability.changed', {
      clinicId: 'CL1',
      doctorId: 'doc-1',
    });
    expect(rooms).toEqual(
      expect.arrayContaining(['clinic:CL1', 'clinic:CL1:public', 'doctor:doc-1', 'user:doc-1'])
    );
  });

  it('does not route non patient-scoped events to a patient user room', () => {
    const rooms = determineTargetRooms('clinic.updated', {
      clinicId: 'CL1',
      patientUserId: 'u-pat',
    });
    expect(rooms).not.toContain('user:u-pat');
  });

  it('dedupes rooms', () => {
    const rooms = determineTargetRooms('payment.completed', {
      userId: 'u-pat',
      patientUserId: 'u-pat',
    });
    expect(rooms).toEqual(['user:u-pat']);
  });
});

describe('socket relay message parsing', () => {
  it('uses a versioned channel', () => {
    expect(SOCKET_RELAY_CHANNEL).toBe('socket:relay:v1');
  });

  it('accepts a valid room emit and a broadcast', () => {
    expect(
      parseSocketRelayMessage(
        JSON.stringify({ rooms: ['user:1', 'clinic:2'], event: 'appointment.updated', data: {} })
      )
    ).toEqual({ rooms: ['user:1', 'clinic:2'], event: 'appointment.updated', data: {} });
    expect(parseSocketRelayMessage(JSON.stringify({ rooms: null, event: 'x', data: {} }))).toEqual({
      rooms: null,
      event: 'x',
      data: {},
    });
  });

  it('keeps a valid message id (for dedupe) and drops an invalid one', () => {
    expect(
      parseSocketRelayMessage(
        JSON.stringify({ id: 'm-1', rooms: ['user:1'], event: 'x', data: {} })
      )
    ).toEqual({ id: 'm-1', rooms: ['user:1'], event: 'x', data: {} });
    expect(
      parseSocketRelayMessage(JSON.stringify({ id: 42, rooms: ['user:1'], event: 'x', data: {} }))
    ).toEqual({ rooms: ['user:1'], event: 'x', data: {} });
  });

  it('rejects malformed messages', () => {
    expect(parseSocketRelayMessage('not json')).toBeNull();
    expect(parseSocketRelayMessage(JSON.stringify({ rooms: [], event: 'x', data: {} }))).toBeNull();
    expect(
      parseSocketRelayMessage(JSON.stringify({ rooms: ['a'], event: '', data: {} }))
    ).toBeNull();
    expect(
      parseSocketRelayMessage(JSON.stringify({ rooms: ['a'], event: 'x', data: [] }))
    ).toBeNull();
    expect(
      parseSocketRelayMessage(JSON.stringify({ rooms: [1], event: 'x', data: {} }))
    ).toBeNull();
    expect(parseSocketRelayMessage(JSON.stringify({ event: 'x', data: {} }))).toBeNull();
  });
});
