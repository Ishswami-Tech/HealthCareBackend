/**
 * Prescription PDF footer: verification QR (approved prescriptions only), the prescribing doctor,
 * the "digitally generated, no signature required" note, plus the small per-page reference line
 * with the prescription number and generation time. No watermark or signature: it is a digital
 * prescription.
 */
import * as QRCode from 'qrcode';
import { formatDateTimeInIST } from '@utils/date-time.util';
import type { PrescriptionPdfData } from '@services/pharmacy/services/prescription-pdf.types';
import {
  contentBottom,
  doctorCredentials,
  newPage,
  pageWidth,
  RX_PAGE,
  RX_THEME,
  type PdfDoc,
} from '@services/pharmacy/services/prescription-pdf.sections';

const QR_SIZE = 80;
const PRESCRIBER_WIDTH = 220;
const DRAFT_STATUSES: ReadonlySet<string> = new Set(['DRAFT', 'RETURNED']);

/** DRAFT / RETURNED prescriptions are not approved yet, so they carry no verification QR. */
export function isDraftStatus(status: string): boolean {
  return DRAFT_STATUSES.has(String(status || '').toUpperCase());
}

/**
 * Plain-text verification payload. There is no public verify route, so the QR carries the
 * prescription number, row id and clinic code for the pharmacy desk to look up.
 */
export function verificationPayload(data: PrescriptionPdfData): string {
  return [
    `RX:${data.prescriptionNumber}`,
    data.prescriptionId ? `ID:${data.prescriptionId}` : null,
    data.clinicCode ? `CLINIC:${data.clinicCode}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(';');
}

/** PNG of the verification QR, or null for drafts / when the encoder fails. */
export async function buildVerificationQr(data: PrescriptionPdfData): Promise<Buffer | null> {
  if (isDraftStatus(data.status)) return null;
  try {
    return await QRCode.toBuffer(verificationPayload(data), {
      type: 'png',
      margin: 1,
      width: 240,
      errorCorrectionLevel: 'M',
      color: { dark: RX_THEME.ink, light: RX_THEME.white },
    });
  } catch {
    return null;
  }
}

export function doctorDisplayName(name: string): string {
  const trimmed = name.trim() || 'Doctor';
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}

function drawQrBlock(doc: PdfDoc, qr: Buffer, x: number, y: number): void {
  doc.image(qr, x, y, { width: QR_SIZE, height: QR_SIZE });
  doc.font('Helvetica').fontSize(7).fillColor(RX_THEME.muted);
  doc.text('Scan to verify', x, y + QR_SIZE + 3, {
    width: QR_SIZE,
    align: 'center',
    lineBreak: false,
  });
}

/** Prescribing doctor (name + credentials) on the right; a digital prescription needs no signature. */
function drawPrescriberBlock(doc: PdfDoc, data: PrescriptionPdfData, top: number): void {
  const x = RX_PAGE.margin + pageWidth(doc) - PRESCRIBER_WIDTH;
  const y = top + 30;
  doc.font('Helvetica').fontSize(7.5).fillColor(RX_THEME.muted);
  doc.text('Prescribed by', x, y, { width: PRESCRIBER_WIDTH, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(RX_THEME.ink);
  doc.text(doctorDisplayName(data.doctorName), x, doc.y + 1, {
    width: PRESCRIBER_WIDTH,
    align: 'right',
  });
  const credentials = doctorCredentials(data);
  if (credentials) {
    doc.font('Helvetica').fontSize(7.5).fillColor(RX_THEME.muted);
    doc.text(credentials, x, doc.y + 1, { width: PRESCRIBER_WIDTH, align: 'right' });
  }
}

/** Footer pinned to the bottom of the last page (a new page when the content reaches it). */
export function drawFooter(
  doc: PdfDoc,
  data: PrescriptionPdfData,
  qr: Buffer | null,
  y: number
): void {
  const top = contentBottom(doc) - RX_PAGE.footerHeight;
  if (y > top) newPage(doc);
  if (qr) drawQrBlock(doc, qr, RX_PAGE.margin, top);
  drawPrescriberBlock(doc, data, top);
  doc.font('Helvetica').fontSize(7.5).fillColor(RX_THEME.muted);
  doc.text(
    'This is a digitally generated prescription and does not require a signature.',
    RX_PAGE.margin,
    top + QR_SIZE + 18,
    { width: pageWidth(doc), align: 'center' }
  );
}

function drawReferenceLine(
  doc: PdfDoc,
  data: PrescriptionPdfData,
  generatedAt: Date,
  page: number,
  pages: number
): void {
  const y = doc.page.height - RX_PAGE.bottomReserve + 12;
  const text = [
    data.prescriptionNumber,
    `Generated ${formatDateTimeInIST(generatedAt)} IST`,
    pages > 1 ? `Page ${page} of ${pages}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join('  ·  ');
  doc.font('Helvetica').fontSize(7).fillColor(RX_THEME.muted).fillOpacity(1);
  doc.text(text, RX_PAGE.margin, y, { width: pageWidth(doc), align: 'center', lineBreak: false });
}

/** The reference line (prescription number, generated time, page) on every buffered page. */
export function decoratePages(doc: PdfDoc, data: PrescriptionPdfData, generatedAt: Date): void {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    drawReferenceLine(doc, data, generatedAt, index - range.start + 1, range.count);
  }
}
