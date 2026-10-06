import type { NotificationData } from '@core/types/appointment.types';
import { formatDateInIST, formatTimeInIST, parseIstDateTime } from '@utils/date-time.util';
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
  const label = formatDateInIST(date, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  // en-IN writes "Tue, 6 Oct, 2026"; drop the comma before the year.
  return label.replace(/,\s*(\d{4})$/, ' $1');
}

/** "2:00 PM" in IST from the row's date plus "HH:mm" time; '' when either is missing. */
export function formatAppointmentTimeLabel(
  date: Date | string | null | undefined,
  time: string | null | undefined
): string {
  if (!date || !time) {
    return '';
  }
  const dateValue = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateValue.getTime())) {
    return '';
  }
  const start = parseIstDateTime(dateValue, time);
  if (!start) {
    return '';
  }
  return formatTimeInIST(start, {
    hour: 'numeric',
    minute: '2-digit',
    second: undefined,
    hour12: true,
  })
    .replace(/\u202f/g, ' ')
    .replace(/\s?(am|pm)$/i, match => match.toUpperCase())
    .trim();
}

/**
 * Complete the template data from the appointment row. The row wins for names, date and time:
 * producers were passing "Patient", "Doctor", "10:00", ISO timestamps and +05:30 offsets, and
 * patients saw all of it verbatim. The payload fills only what the row cannot.
 */
export function mergeAppointmentFacts(
  templateData: TemplateData,
  appointment: AppointmentFactsSource | null | undefined
): TemplateData {
  if (!appointment) {
    return templateData;
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
    formatAppointmentDateLabel(appointment.date) || templateData.appointmentDate;
  const appointmentTime =
    formatAppointmentTimeLabel(appointment.date, appointment.time) || templateData.appointmentTime;
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
