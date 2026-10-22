/**
 * Download name of a prescription PDF: `<RxNumber>_<PatientName>.pdf`, e.g.
 * `RX-2026-000123_Priya_Sharma.pdf`.
 *
 * The name goes into a `Content-Disposition` header, so it is reduced to a safe ASCII set:
 * letters, digits, `.`, `-` and `_` (spaces and everything else become `_`, runs collapse, no
 * leading/trailing separators), each part capped in length. Missing parts fall back to
 * `Prescription` / `Patient`.
 */

const MAX_PART_LENGTH = 60;

function safePart(value: string | null | undefined, fallback: string): string {
  const cleaned = String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, MAX_PART_LENGTH)
    .replace(/[._-]+$/g, '');
  return cleaned || fallback;
}

export function prescriptionPdfFileName(
  prescriptionNumber: string | null | undefined,
  patientName: string | null | undefined
): string {
  return `${safePart(prescriptionNumber, 'Prescription')}_${safePart(patientName, 'Patient')}.pdf`;
}
