import assert from 'node:assert/strict';
import {
  APPOINTMENT_CANCELABLE_STATUSES,
  APPOINTMENT_STATUS_TRANSITIONS,
  canCancelAppointmentStatus,
  isValidAppointmentStatusTransition,
} from '../src/services/appointments/core/appointment-state-contract.ts';

function main() {
  assert.equal(isValidAppointmentStatusTransition('AWAITING_SLOT_CONFIRMATION', 'CONFIRMED'), true);
  assert.equal(isValidAppointmentStatusTransition('WAITING', 'IN_PROGRESS'), true);
  assert.equal(canCancelAppointmentStatus('AWAITING_SLOT_CONFIRMATION'), true);
  assert.equal(canCancelAppointmentStatus('COMPLETED'), false);

  assert.ok(APPOINTMENT_CANCELABLE_STATUSES.has('FOLLOW_UP_SCHEDULED'));
  assert.deepEqual(APPOINTMENT_STATUS_TRANSITIONS['RESCHEDULED'], [
    'SCHEDULED',
    'CONFIRMED',
    'CANCELLED',
  ]);

  console.log('Backend production contract checks passed.');
}

main();
