import type { DatabaseService } from '@infrastructure/database';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';

/**
 * Doctor slot rule: one doctor may hold two appointments in the same time slot only when one is a
 * VIDEO_CALL and the other is an in-clinic visit. Two video visits, or two in-clinic visits, may
 * not share a slot. Every type that is not VIDEO_CALL belongs to the in-clinic kind.
 *
 * The same rule feeds the availability grid, the booking check and the reschedule check, so a slot
 * is never offered that the booking would then refuse (or the other way round).
 */

export type AppointmentSlotKind = 'VIDEO' | 'IN_CLINIC';

/** Statuses that free the slot. Everything else (PENDING, SCHEDULED, CONFIRMED...) holds it. */
export const SLOT_FREEING_STATUSES: readonly string[] = [
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW',
  'EXPIRED',
];

/** Length of the slot being requested: the quarter-hour video grid, the 3-minute clinic grid. */
const VIDEO_SLOT_MINUTES = 15;
const IN_CLINIC_SLOT_MINUTES = 3;
/** Occupancy of an existing appointment that carries no duration. */
const DEFAULT_BOOKED_MINUTES = 30;

export interface DoctorDayAppointment {
  readonly id: string;
  readonly type?: string | null | undefined;
  readonly time?: string | null | undefined;
  readonly duration?: number | null | undefined;
}

export function appointmentSlotKind(type: string | null | undefined): AppointmentSlotKind {
  return String(type ?? '').toUpperCase() === 'VIDEO_CALL' ? 'VIDEO' : 'IN_CLINIC';
}

function toMinutes(time: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * The kind of visit that already holds the requested slot, or null when the slot is free for this
 * type. `existing` must already be limited to the doctor, the clinic, the day and the statuses
 * that hold a slot (see loadDoctorDayAppointments).
 */
export function findConflictingSlotKind(
  existing: readonly DoctorDayAppointment[],
  request: { type: string | null | undefined; time: string }
): AppointmentSlotKind | null {
  const kind = appointmentSlotKind(request.type);
  const slotStart = toMinutes(request.time);
  if (slotStart === null) {
    return null;
  }
  const slotEnd = slotStart + (kind === 'VIDEO' ? VIDEO_SLOT_MINUTES : IN_CLINIC_SLOT_MINUTES);

  const conflicting = existing.some(row => {
    if (appointmentSlotKind(row.type) !== kind) {
      return false;
    }
    const rowStart = toMinutes(row.time);
    if (rowStart === null) {
      return false;
    }
    const rowEnd = rowStart + (row.duration || DEFAULT_BOOKED_MINUTES);
    return rowStart < slotEnd && rowEnd > slotStart;
  });

  return conflicting ? kind : null;
}

export function slotConflictMessage(kind: AppointmentSlotKind): string {
  return kind === 'VIDEO'
    ? 'This doctor already has a video visit in that slot'
    : 'This doctor already has an in-clinic visit in that slot';
}

/**
 * The doctor's appointments of one IST day that still hold a slot, in the given clinic. Read fresh
 * (never from a cache): this runs inside the booking lock, right before the write.
 *
 * @param dayKey the IST calendar day, YYYY-MM-DD
 * @param excludeAppointmentId the appointment being moved (reschedule): it never conflicts with itself
 */
export async function loadDoctorDayAppointments(
  databaseService: Pick<DatabaseService, 'executeHealthcareRead'>,
  params: {
    doctorId: string;
    clinicId: string;
    dayKey: string;
    excludeAppointmentId?: string;
  }
): Promise<DoctorDayAppointment[]> {
  const dayStart = new Date(`${params.dayKey}T00:00:00.000+05:30`);
  const dayEnd = new Date(`${params.dayKey}T23:59:59.999+05:30`);

  return await databaseService.executeHealthcareRead(async client => {
    const delegate = client['appointment'] as unknown as {
      findMany: (args: PrismaDelegateArgs) => Promise<DoctorDayAppointment[]>;
    };
    return await delegate.findMany({
      where: {
        doctorId: params.doctorId,
        clinicId: params.clinicId,
        ...(params.excludeAppointmentId ? { id: { not: params.excludeAppointmentId } } : {}),
        date: { gte: dayStart, lte: dayEnd },
        status: { notIn: [...SLOT_FREEING_STATUSES] },
      },
      select: { id: true, type: true, time: true, duration: true },
    } as PrismaDelegateArgs);
  });
}
