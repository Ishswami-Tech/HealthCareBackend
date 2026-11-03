/**
 * Patient-facing invoice / line-item text. Every helper here produces words a patient can read
 * on a bill ("Video consultation with Dr. Rao — 22 Oct 2026, 10:30 AM"); internal ids (uuids,
 * appointment ids) never appear. Ids stay in invoice metadata / the typed FK columns.
 */
import { formatDateInIST, formatDateKeyInIST, parseIstDateTime } from '@utils/date-time.util';
import { formatVisitTimeLabel } from '@utils/appointment-when.util';

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DOCTOR_PREFIX = /^dr\.?\s+/i;
const EM_DASH = '—';
const GENERIC_TREATMENT_LABELS = new Set(['general consultation', 'consultation', '']);

const VISIT_MODE_LABELS: Readonly<Record<string, string>> = {
  VIDEO_CALL: 'Video consultation',
  IN_PERSON: 'In-clinic consultation',
  HOME_VISIT: 'Home visit',
};

const INTERVAL_LABELS: Readonly<Record<string, string>> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly',
};

const INTERVAL_UNITS: Readonly<Record<string, string>> = {
  DAILY: 'days',
  WEEKLY: 'weeks',
  MONTHLY: 'months',
  QUARTERLY: 'quarters',
  YEARLY: 'years',
};

/** Removes any uuid from free text and tidies the gaps it leaves behind. */
export function stripInternalIds(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(UUID_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.)\]])/g, '$1')
    .replace(/(\bfor|\bof|#)\s*$/i, '')
    .trim();
}

/** "VIDEO_CALL" -> "Video consultation"; unknown types fall back to "Consultation". */
export function visitModeLabel(appointmentType: string | null | undefined): string {
  return VISIT_MODE_LABELS[String(appointmentType ?? '').toUpperCase()] ?? 'Consultation';
}

/** "Rao" / "Dr Rao" / "Dr. Rao" -> "Dr. Rao"; '' when no name is known. */
export function formatDoctorName(name: string | null | undefined): string {
  const trimmed = stripInternalIds(name);
  if (!trimmed) {
    return '';
  }
  return `Dr. ${trimmed.replace(DOCTOR_PREFIX, '')}`;
}

/** "22 Oct 2026, 10:30 AM" (IST) from the appointment day key and its "HH:mm" clock time. */
export function formatInvoiceVisitWhen(
  date: Date | string | null | undefined,
  time: string | null | undefined
): string {
  if (!date) {
    return '';
  }
  const dayLabel = formatDateInIST(date, { day: 'numeric', month: 'short', year: 'numeric' });
  if (!dayLabel) {
    return '';
  }
  const instant = time ? parseIstDateTime(date, time) : null;
  const timeLabel = instant ? formatVisitTimeLabel(instant) : '';
  return timeLabel ? `${dayLabel}, ${timeLabel}` : dayLabel;
}

export interface AppointmentInvoiceText {
  appointmentType: string | null | undefined;
  doctorName?: string | null | undefined;
  date?: Date | string | null | undefined;
  time?: string | null | undefined;
  /** Treatment label (e.g. "Panchakarma"); a generic "General Consultation" is not repeated. */
  treatmentLabel?: string | null | undefined;
}

/** "Video consultation (Panchakarma) with Dr. X — 22 Oct 2026, 10:30 AM". */
export function buildAppointmentInvoiceDescription(input: AppointmentInvoiceText): string {
  const mode = visitModeLabel(input.appointmentType);
  const treatment = stripInternalIds(input.treatmentLabel);
  const withTreatment = GENERIC_TREATMENT_LABELS.has(treatment.toLowerCase())
    ? mode
    : `${mode} (${treatment})`;
  const doctor = formatDoctorName(input.doctorName);
  const subject = doctor ? `${withTreatment} with ${doctor}` : withTreatment;
  const when = formatInvoiceVisitWhen(input.date, input.time);
  return when ? `${subject} ${EM_DASH} ${when}` : subject;
}

/** "Ayurveda Care Plan — monthly" / "Ayurveda Care Plan — every 2 months". */
export function buildPlanInvoiceDescription(
  planName: string | null | undefined,
  interval?: string | null,
  intervalCount?: number | null
): string {
  const name = stripInternalIds(planName) || 'Care plan';
  const key = String(interval ?? '').toUpperCase();
  const count = Number(intervalCount ?? 1);
  if (!INTERVAL_LABELS[key]) {
    return name;
  }
  const cadence =
    Number.isFinite(count) && count > 1
      ? `every ${count} ${INTERVAL_UNITS[key]}`
      : INTERVAL_LABELS[key];
  return `${name} ${EM_DASH} ${cadence}`;
}

/** Same format as pharmacy `buildPrescriptionNumber`: RX-YYYYMMDD-<first 8 hex of the id>. */
export function prescriptionReference(prescription: {
  id: string;
  date?: Date | string | null;
  prescriptionNumber?: string | null;
}): string {
  const stored = prescription.prescriptionNumber?.trim();
  if (stored) {
    return stored;
  }
  const dateKey = formatDateKeyInIST(prescription.date ?? new Date()).replace(/-/g, '');
  const idPart = prescription.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `RX-${dateKey}-${idPart}`;
}

/** "Medicines — Rx #RX-20261022-A1B2C3D4"; plain "Medicines" when no reference is known. */
export function buildPharmacyInvoiceDescription(reference: string | null | undefined): string {
  const ref = stripInternalIds(reference);
  return ref ? `Medicines ${EM_DASH} Rx #${ref}` : 'Medicines';
}
