import { AppointmentStatus } from '@core/types/enums.types';
import { nowIso } from '@utils/date-time.util';

/** Inputs of the `appointment.checked_in` / `appointment.confirmed` events every check-in emits. */
export interface CheckInEventParams {
  appointmentId: string;
  clinicId: string;
  patientId?: string | undefined;
  doctorId?: string | undefined;
  locationId?: string | undefined;
  checkedInBy: string;
  checkInMethod: string;
  source: string;
  notes?: string | undefined;
  overrideReason?: string | undefined;
}

/** The two event names a recorded arrival emits (notifications, queue boards, analytics listen). */
export const CHECK_IN_EVENT_NAMES = ['appointment.checked_in', 'appointment.confirmed'] as const;

/**
 * One payload shape for every check-in path (QR scan, reception one-click, override), so the
 * listeners never have to tell them apart.
 */
export function buildCheckInEventPayload(params: CheckInEventParams): Record<string, unknown> {
  const checkedInAt = nowIso();
  return {
    appointmentId: params.appointmentId,
    clinicId: params.clinicId,
    userId: params.patientId || params.checkedInBy,
    patientId: params.patientId,
    doctorId: params.doctorId,
    locationId: params.locationId,
    checkedInBy: params.checkedInBy,
    confirmedBy: params.checkedInBy,
    checkInMethod: params.checkInMethod,
    checkedInAt,
    appointment: {
      appointmentId: params.appointmentId,
      id: params.appointmentId,
      clinicId: params.clinicId,
      patientId: params.patientId,
      doctorId: params.doctorId,
      locationId: params.locationId,
      checkedInAt,
      status: AppointmentStatus.CONFIRMED,
    },
    metadata: {
      appointmentId: params.appointmentId,
      clinicId: params.clinicId,
      patientId: params.patientId,
      doctorId: params.doctorId,
      locationId: params.locationId,
      checkedInBy: params.checkedInBy,
      confirmedBy: params.checkedInBy,
      checkInMethod: params.checkInMethod,
      checkedInAt,
      notes: params.notes,
      overrideReason: params.overrideReason,
      source: params.source,
    },
  };
}
