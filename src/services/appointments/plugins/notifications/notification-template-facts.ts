import type { NotificationData } from '@core/types/appointment.types';
import {
  formatVisitDateLabel,
  formatVisitTimeFromClock,
  humanizeVisitDate,
  humanizeVisitTime,
} from '@utils/appointment-when.util';
import { resolveUserDisplayName } from '@utils/display-name.util';

type TemplateData = NotificationData['templateData'];

type PersonUser = { name?: string | null; firstName?: string | null; lastName?: string | null };

/** The appointment columns and relations the template data is completed from. */
export interface AppointmentFactsSource {
  date?: Date | string | null;
  time?: string | null;
  type?: unknown;
  patient?: { user?: PersonUser | null } | null;
  doctor?: { user?: PersonUser | null } | null;
  clinic?: { name?: string | null } | null;
}

export interface MergeAppointmentFactsOptions {
  /**
   * Whether the row's date and time describe the visit being announced. False for a follow-up
   * notice: its date is the future follow-up while its appointmentId is the visit it follows.
   * Defaults to true.
   */
  rowDescribesVisit?: boolean;
}

/** Values producers pass when they have no real one; never shown to a patient as-is. */
const PLACEHOLDER_NAMES: ReadonlySet<string> = new Set(['', 'patient', 'doctor', 'tbd']);
const PLACEHOLDER_LOCATIONS: ReadonlySet<string> = new Set([
  '',
  'clinic',
  'healthcare clinic',
  'tbd',
]);

export function isPlaceholderText(value: unknown, placeholders: ReadonlySet<string>): boolean {
  return typeof value !== 'string' || placeholders.has(value.trim().toLowerCase());
}

/** "Tue, 6 Oct 2026" in IST; '' when the date is missing or unparseable. */
export function formatAppointmentDateLabel(date: Date | string | null | undefined): string {
  return formatVisitDateLabel(date);
}

/** "2:00 PM" in IST from the row's date plus "HH:mm" time; '' when either is missing. */
export function formatAppointmentTimeLabel(
  date: Date | string | null | undefined,
  time: string | null | undefined
): string {
  return formatVisitTimeFromClock(date, time);
}

/**
 * Complete the template data from the appointment row. The row wins for names, date and time
 * (unless `rowDescribesVisit` is false): producers were passing "Patient", "Doctor", "10:00",
 * ISO timestamps and +05:30 offsets, and patients saw all of it verbatim. Whatever the payload
 * still supplies is humanized too, so a raw timestamp never reaches a message even without a row.
 */
export function mergeAppointmentFacts(
  templateData: TemplateData,
  appointment: AppointmentFactsSource | null | undefined,
  options: MergeAppointmentFactsOptions = {}
): TemplateData {
  const rowDescribesVisit = options.rowDescribesVisit ?? true;
  const payloadDate = humanizeVisitDate(templateData.appointmentDate);
  const payloadTime = humanizeVisitTime(templateData.appointmentTime, templateData.appointmentDate);

  if (!appointment) {
    return { ...templateData, appointmentDate: payloadDate, appointmentTime: payloadTime };
  }

  const payloadPatientName = isPlaceholderText(templateData.patientName, PLACEHOLDER_NAMES)
    ? ''
    : templateData.patientName;
  const payloadDoctorName = isPlaceholderText(templateData.doctorName, PLACEHOLDER_NAMES)
    ? ''
    : templateData.doctorName;

  const patientName = resolveUserDisplayName(appointment.patient?.user) || payloadPatientName;
  const doctorName = resolveUserDisplayName(appointment.doctor?.user) || payloadDoctorName;
  const appointmentDate =
    (rowDescribesVisit && formatAppointmentDateLabel(appointment.date)) || payloadDate;
  const appointmentTime =
    (rowDescribesVisit && formatAppointmentTimeLabel(appointment.date, appointment.time)) ||
    payloadTime;
  const clinicName = (appointment.clinic?.name || '').trim() || templateData.clinicName;
  const location = isPlaceholderText(templateData.location, PLACEHOLDER_LOCATIONS)
    ? clinicName
    : templateData.location;
  const appointmentType =
    templateData.appointmentType ||
    (typeof appointment.type === 'string' && appointment.type ? appointment.type : undefined);

  return {
    ...templateData,
    patientName,
    doctorName,
    appointmentDate,
    appointmentTime,
    clinicName,
    location,
    ...(appointmentType ? { appointmentType } : {}),
  };
}
