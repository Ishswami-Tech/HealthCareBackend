import { describe, expect, it } from '@jest/globals';
import {
  isQueueBoardEventWithoutPatient,
  recipientUserIds,
  remapRecipientUserIds,
} from '@communication/listeners/recipient-user-id.util';

const DOCTOR_PROFILE = '9e05b9ea-5927-4f33-ac3a-e99ddda8569c';
const DOCTOR_USER = '6a38ca5e-7bda-41e6-abf9-b13df3181cc9';

describe('remapRecipientUserIds', () => {
  it('readdresses a Doctor.id recipient (and its user room) to the doctor user', () => {
    const recipients = [
      { userId: 'patient-user', socketRoom: 'user:patient-user' },
      { userId: DOCTOR_PROFILE, socketRoom: `user:${DOCTOR_PROFILE}` },
      { socketRoom: 'clinic:c1' },
    ];
    expect(remapRecipientUserIds(recipients, new Map([[DOCTOR_PROFILE, DOCTOR_USER]]))).toEqual([
      { userId: 'patient-user', socketRoom: 'user:patient-user' },
      { userId: DOCTOR_USER, socketRoom: `user:${DOCTOR_USER}` },
      { socketRoom: 'clinic:c1' },
    ]);
  });

  it('keeps a custom room and drops a duplicate once both ids name the same user', () => {
    const recipients = [
      { userId: DOCTOR_USER, socketRoom: `user:${DOCTOR_USER}` },
      { userId: DOCTOR_PROFILE, socketRoom: `user:${DOCTOR_PROFILE}` },
      { userId: DOCTOR_PROFILE, socketRoom: 'appointment:a1' },
    ];
    expect(remapRecipientUserIds(recipients, new Map([[DOCTOR_PROFILE, DOCTOR_USER]]))).toEqual([
      { userId: DOCTOR_USER, socketRoom: `user:${DOCTOR_USER}` },
      { userId: DOCTOR_USER, socketRoom: 'appointment:a1' },
    ]);
  });

  it('leaves everything unchanged when no id is a profile id', () => {
    const recipients = [{ userId: 'u1' }, { email: 'a@example.test' }];
    expect(remapRecipientUserIds(recipients, new Map())).toEqual(recipients);
    expect(recipientUserIds([...recipients, { userId: 'u1' }])).toEqual(['u1']);
  });
});

describe('isQueueBoardEventWithoutPatient', () => {
  const board = {
    eventType: 'appointment.queue.updated',
    payload: { doctorId: DOCTOR_PROFILE, action: 'REORDERED', clinicId: 'c1' },
  };

  it('a queue-board refresh without any patient id is not a patient notification', () => {
    expect(isQueueBoardEventWithoutPatient('appointment.queue.updated', board)).toBe(true);
    expect(isQueueBoardEventWithoutPatient('appointment.queue.reordered', board)).toBe(true);
  });

  it('still notifies when the event names a patient, and ignores other events', () => {
    expect(
      isQueueBoardEventWithoutPatient('appointment.queue.updated', {
        ...board,
        payload: { ...board.payload, patientId: 'p1' },
      })
    ).toBe(false);
    expect(
      isQueueBoardEventWithoutPatient('appointment.queue.updated', { ...board, userId: 'u1' })
    ).toBe(false);
    expect(
      isQueueBoardEventWithoutPatient('appointment.queue.updated', {
        ...board,
        metadata: { patientId: 'p1' },
      })
    ).toBe(false);
    expect(isQueueBoardEventWithoutPatient('appointment.confirmed', board)).toBe(false);
  });

  it('a position refresh (read-path, no patient) is skipped, not a patient notification', () => {
    const positionRead = {
      eventType: 'appointment.queue.position.updated',
      appointmentId: 'a1',
      payload: { appointmentId: 'a1', position: 2, totalInQueue: 5, doctorId: DOCTOR_PROFILE },
    };
    expect(
      isQueueBoardEventWithoutPatient('appointment.queue.position.updated', positionRead)
    ).toBe(true);
    expect(
      isQueueBoardEventWithoutPatient('appointment.queue.position.updated', {
        ...positionRead,
        payload: { ...positionRead.payload, patientId: 'p1' },
      })
    ).toBe(false);
  });
});
