export const APPOINTMENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['SCHEDULED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  SCHEDULED: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  CONFIRMED: ['IN_PROGRESS', 'NO_SHOW', 'EXPIRED', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'NO_SHOW', 'CANCELLED', 'EXPIRED'],
  ON_HOLD: ['SCHEDULED', 'CANCELLED', 'RESCHEDULED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'ON_HOLD'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: ['RESCHEDULED'],
  EXPIRED: [],
  RESCHEDULED: ['SCHEDULED', 'CONFIRMED', 'CANCELLED'],
  AWAITING_SLOT_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED'],
  FOLLOW_UP_SCHEDULED: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
  DISCHARGED: [],
  TRANSFERRED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED'],
};

export const APPOINTMENT_CANCELABLE_STATUSES = new Set<string>([
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'WAITING',
  'ON_HOLD',
  'AWAITING_SLOT_CONFIRMATION',
  'FOLLOW_UP_SCHEDULED',
]);

export function isVideoSlotAwaitingConfirmation(appointment: {
  type?: string | null | undefined;
  status?: string | null | undefined;
  proposedSlots?: unknown;
  confirmedSlotIndex?: number | null | undefined;
}): boolean {
  if (String(appointment.type || '').toUpperCase() !== 'VIDEO_CALL') {
    return false;
  }

  const hasProposedSlots =
    Array.isArray(appointment.proposedSlots) && appointment.proposedSlots.length > 0;
  const confirmedSlotIndex = appointment.confirmedSlotIndex;
  const hasConfirmedSlot =
    confirmedSlotIndex !== null &&
    confirmedSlotIndex !== undefined &&
    !Number.isNaN(Number(confirmedSlotIndex));

  if (String(appointment.status || '').toUpperCase() === 'AWAITING_SLOT_CONFIRMATION') {
    return true;
  }

  return hasProposedSlots && !hasConfirmedSlot;
}

export function isValidAppointmentStatusTransition(
  currentStatus: string,
  newStatus: string
): boolean {
  return APPOINTMENT_STATUS_TRANSITIONS[currentStatus]?.includes(newStatus) ?? false;
}

export function canCancelAppointmentStatus(currentStatus: string): boolean {
  return APPOINTMENT_CANCELABLE_STATUSES.has(currentStatus);
}
