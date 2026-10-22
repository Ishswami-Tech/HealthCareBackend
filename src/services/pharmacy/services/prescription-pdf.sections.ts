/**
 * Drawing helpers for the prescription PDF (letterhead, patient grid, medicines table, advice,
 * investigations, follow-up, footer, draft watermark). Every helper takes the current y and
 * returns the y below what it drew, so the layout reads top to bottom in prescription-pdf.util.ts.
 */
import { formatDateInIST } from '@utils/date-time.util';
import type {
  PrescriptionPdfData,
  PrescriptionPdfFollowUp,
  PrescriptionPdfInvestigation,
  PrescriptionPdfItem,
} from '@services/pharmacy/services/prescription-pdf.types';

export type PdfDoc = PDFKit.PDFDocument;

export const RX_THEME = {
  brand: '#0F766E',
  brandDark: '#115E59',
  brandSoft: '#ECFDF5',
  followUpFill: '#F0FDF4',
  followUpStroke: '#BBF7D0',
  ink: '#0F172A',
  muted: '#64748B',
  rule: '#E2E8F0',
  zebra: '#F8FAFC',
  danger: '#DC2626',
  white: '#FFFFFF',
} as const;

export const RX_PAGE = {
  margin: 40,
  /** Space kept free at the bottom of every page for the reference line. */
  bottomReserve: 34,
  footerHeight: 118,
} as const;

const LABEL_SIZE = 7.5;
const VALUE_SIZE = 10.5;
const LOGO_SIZE = 46;

export const pageWidth = (doc: PdfDoc): number => doc.page.width - RX_PAGE.margin * 2;
export const contentBottom = (doc: PdfDoc): number => doc.page.height - RX_PAGE.bottomReserve;

const clean = (value?: string | null): string => (typeof value === 'string' ? value.trim() : '');

/** Starts a new page and returns the top y of its content area. */
export function newPage(doc: PdfDoc): number {
  doc.addPage();
  return RX_PAGE.margin;
}

/** Same page when `height` still fits above the bottom reserve, otherwise a new page. */
export function ensureSpace(doc: PdfDoc, y: number, height: number): number {
  return y + height > contentBottom(doc) ? newPage(doc) : y;
}

function label(doc: PdfDoc, text: string, x: number, y: number, width: number): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(LABEL_SIZE)
    .fillColor(RX_THEME.muted)
    .text(text.toUpperCase(), x, y, { width, characterSpacing: 0.6, lineBreak: false });
}

// ------------------------------------------------------------------ letterhead

/** Accepts only inline PNG / JPEG data URIs (nothing is fetched while rendering). */
function decodeLogo(logo?: string | null): Buffer | null {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(clean(logo));
  if (!match?.[2]) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length > 0 && buffer.length <= 2_000_000 ? buffer : null;
}

/** Brand tile: teal rounded square with a white heart and a teal pulse line through it. */
function drawLogoTile(doc: PdfDoc, x: number, y: number): void {
  doc.save();
  doc.roundedRect(x, y, LOGO_SIZE, LOGO_SIZE, 11).fill(RX_THEME.brand);
  const scale = LOGO_SIZE / 34;
  doc
    .translate(x + 5 * scale, y + 6 * scale)
    .scale(scale)
    .path(
      'M12 22 C 4 16 0 12 0 7 C 0 3 3 0 6.5 0 C 9 0 11 1.5 12 3.5 C 13 1.5 15 0 17.5 0 C 21 0 24 3 24 7 C 24 12 20 16 12 22 Z'
    )
    .fill(RX_THEME.white);
  doc
    .moveTo(1, 10)
    .lineTo(7, 10)
    .lineTo(9.5, 5.5)
    .lineTo(13, 15)
    .lineTo(15.5, 10)
    .lineTo(23, 10)
    .lineWidth(1.8)
    .lineJoin('round')
    .lineCap('round')
    .stroke(RX_THEME.brand);
  doc.restore();
}

function drawLogo(doc: PdfDoc, data: PrescriptionPdfData, x: number, y: number): void {
  const logo = decodeLogo(data.clinicLogo);
  if (logo) {
    try {
      doc.image(logo, x, y, { fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center' });
      return;
    } catch {
      // Not a decodable image: fall back to the drawn tile below.
    }
  }
  drawLogoTile(doc, x, y);
}

function drawClinicBlock(
  doc: PdfDoc,
  data: PrescriptionPdfData,
  x: number,
  y: number,
  width: number
): number {
  doc.font('Helvetica-Bold').fontSize(17).fillColor(RX_THEME.brand);
  doc.text(clean(data.clinicName) || 'Clinic', x, y, { width });
  let cursor = doc.y + 2;
  doc.font('Helvetica').fontSize(8.5).fillColor(RX_THEME.muted);
  const address = clean(data.clinicAddress);
  if (address) {
    doc.text(address, x, cursor, { width });
    cursor = doc.y + 1;
  }
  const contact = [clean(data.clinicPhone), clean(data.clinicEmail)].filter(Boolean).join('  ·  ');
  if (contact) {
    doc.text(contact, x, cursor, { width });
    cursor = doc.y;
  }
  return cursor;
}

export function doctorCredentials(data: PrescriptionPdfData): string {
  const parts = [clean(data.doctorQualification), clean(data.doctorSpecialization)].filter(Boolean);
  return Array.from(new Set(parts)).join(', ');
}

function drawDoctorBlock(
  doc: PdfDoc,
  data: PrescriptionPdfData,
  x: number,
  y: number,
  width: number
): number {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(RX_THEME.ink);
  doc.text(clean(data.doctorName) || 'Doctor', x, y, { width, align: 'right' });
  let cursor = doc.y + 2;
  const credentials = doctorCredentials(data);
  if (credentials) {
    doc.font('Helvetica').fontSize(8.5).fillColor(RX_THEME.brand);
    doc.text(credentials, x, cursor, { width, align: 'right' });
    cursor = doc.y + 1;
  }
  const registration = clean(data.doctorRegistrationNumber);
  if (registration) {
    doc.font('Helvetica').fontSize(8.5).fillColor(RX_THEME.muted);
    doc.text(`Reg. No. ${registration}`, x, cursor, { width, align: 'right' });
    cursor = doc.y;
  }
  return cursor;
}

export function drawLetterhead(doc: PdfDoc, data: PrescriptionPdfData, y: number): number {
  const left = RX_PAGE.margin;
  const width = pageWidth(doc);
  const doctorWidth = 190;
  const clinicX = left + LOGO_SIZE + 12;
  drawLogo(doc, data, left, y);
  const clinicBottom = drawClinicBlock(
    doc,
    data,
    clinicX,
    y + 1,
    width - LOGO_SIZE - 12 - doctorWidth - 12
  );
  const doctorBottom = drawDoctorBlock(doc, data, left + width - doctorWidth, y + 2, doctorWidth);
  const ruleY = Math.max(y + LOGO_SIZE, clinicBottom, doctorBottom) + 10;
  doc
    .moveTo(left, ruleY)
    .lineTo(left + width, ruleY)
    .lineWidth(1.6)
    .stroke(RX_THEME.brand);
  return ruleY + 12;
}

// ------------------------------------------------------------------ patient grid

interface GridCell {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}

function drawGridRow(doc: PdfDoc, cells: readonly GridCell[], y: number): number {
  const columnWidth = pageWidth(doc) / 3;
  let bottom = y;
  cells.forEach((cell, index) => {
    const x = RX_PAGE.margin + index * columnWidth;
    const width = columnWidth - 10;
    label(doc, cell.label, x, y, width);
    doc
      .font('Helvetica-Bold')
      .fontSize(VALUE_SIZE)
      .fillColor(cell.color ?? RX_THEME.ink);
    doc.text(cell.value || '-', x, y + 11, { width });
    bottom = Math.max(bottom, doc.y);
  });
  return bottom + 8;
}

export function ageSexLabel(data: PrescriptionPdfData): string {
  const age = typeof data.patientAge === 'number' ? `${data.patientAge} yrs` : '';
  const sex = clean(data.patientGender);
  const pretty = sex ? sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase() : '';
  return [age, pretty].filter(Boolean).join(' / ') || '-';
}

export function drawPatientGrid(doc: PdfDoc, data: PrescriptionPdfData, y: number): number {
  const first: GridCell[] = [
    { label: 'Patient', value: clean(data.patientName) || 'Patient' },
    { label: 'Age / Sex', value: ageSexLabel(data) },
    { label: 'Date', value: data.prescribedAt ? formatDateInIST(data.prescribedAt) : '-' },
  ];
  const patientId = clean(data.patientUhid) || clean(data.patientNumber);
  const allergies = (data.patientAllergies ?? []).map(entry => clean(entry)).filter(Boolean);
  const second: GridCell[] = [
    ...(patientId ? [{ label: 'Patient ID', value: patientId }] : []),
    ...(clean(data.patientWeight) ? [{ label: 'Weight', value: clean(data.patientWeight) }] : []),
    ...(allergies.length
      ? [{ label: 'Allergy', value: allergies.join(', '), color: RX_THEME.danger }]
      : []),
  ];
  let cursor = drawGridRow(doc, first, y);
  if (second.length) cursor = drawGridRow(doc, second, cursor);
  doc
    .moveTo(RX_PAGE.margin, cursor)
    .lineTo(RX_PAGE.margin + pageWidth(doc), cursor)
    .lineWidth(0.6)
    .stroke(RX_THEME.rule);
  return cursor + 10;
}

export function drawDiagnosis(
  doc: PdfDoc,
  diagnosis: string | null | undefined,
  y: number
): number {
  const text = clean(diagnosis);
  if (!text) return y;
  const width = pageWidth(doc);
  doc.font('Helvetica-Bold').fontSize(VALUE_SIZE);
  const start = ensureSpace(doc, y, 14 + doc.heightOfString(text, { width }));
  label(doc, 'Diagnosis', RX_PAGE.margin, start, width);
  doc.font('Helvetica-Bold').fontSize(VALUE_SIZE).fillColor(RX_THEME.ink);
  doc.text(text, RX_PAGE.margin, start + 11, { width });
  return doc.y + 12;
}

// ------------------------------------------------------------------ medicines table

interface Column {
  readonly title: string;
  readonly width: number;
}

const COLUMNS: readonly Column[] = [
  { title: '#', width: 28 },
  { title: 'Medicine', width: 162 },
  { title: 'Dose', width: 68 },
  { title: 'Freq.', width: 62 },
  { title: 'Duration', width: 62 },
  { title: 'Timing / Instructions', width: 133 },
];
const CELL_PAD = 6;
const HEADER_HEIGHT = 20;

function columnX(index: number): number {
  return RX_PAGE.margin + COLUMNS.slice(0, index).reduce((sum, column) => sum + column.width, 0);
}

function drawTableHeader(doc: PdfDoc, y: number): number {
  doc.rect(RX_PAGE.margin, y, pageWidth(doc), HEADER_HEIGHT).fill(RX_THEME.brandSoft);
  COLUMNS.forEach((column, index) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(RX_THEME.brandDark)
      .text(column.title.toUpperCase(), columnX(index) + CELL_PAD, y + 7, {
        width: column.width - CELL_PAD * 2,
        characterSpacing: 0.4,
        lineBreak: false,
      });
  });
  return y + HEADER_HEIGHT;
}

function medicineTitle(item: PrescriptionPdfItem): string {
  const name = clean(item.medicineName) || 'Medicine';
  const strength = clean(item.strength);
  return strength && !name.toLowerCase().includes(strength.toLowerCase())
    ? `${name} ${strength}`
    : name;
}

function medicineSubline(item: PrescriptionPdfItem): string {
  const category = clean(item.category);
  const form = category ? category.charAt(0).toUpperCase() + category.slice(1).toLowerCase() : '';
  const qty =
    item.quantity > 0
      ? `Qty ${item.quantity}${clean(item.unit) ? ` ${clean(item.unit)}` : ''}`
      : '';
  return [form, qty].filter(Boolean).join('  ·  ');
}

function rowCells(item: PrescriptionPdfItem, index: number): readonly string[] {
  return [
    String(index + 1),
    medicineTitle(item),
    clean(item.dosage) || '-',
    clean(item.frequency) || '-',
    clean(item.duration) || '-',
    clean(item.instructions) || '-',
  ];
}

function measureRow(doc: PdfDoc, cells: readonly string[], subline: string): number {
  const heights = cells.map((cell, index) => {
    const width = (COLUMNS[index]?.width ?? 0) - CELL_PAD * 2;
    doc.font(index === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const main = doc.heightOfString(cell, { width });
    if (index !== 1 || !subline) return main;
    doc.font('Helvetica').fontSize(7.5);
    return main + 2 + doc.heightOfString(subline, { width });
  });
  return Math.max(...heights) + CELL_PAD * 2;
}

function drawRow(
  doc: PdfDoc,
  item: PrescriptionPdfItem,
  index: number,
  y: number,
  height: number
): void {
  const cells = rowCells(item, index);
  if (index % 2 === 1) doc.rect(RX_PAGE.margin, y, pageWidth(doc), height).fill(RX_THEME.zebra);
  cells.forEach((cell, column) => {
    const width = (COLUMNS[column]?.width ?? 0) - CELL_PAD * 2;
    doc
      .font(column === 1 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9)
      .fillColor(column === 0 ? RX_THEME.muted : RX_THEME.ink)
      .text(cell, columnX(column) + CELL_PAD, y + CELL_PAD, { width });
    const subline = column === 1 ? medicineSubline(item) : '';
    if (subline) {
      // Right below the medicine name (doc.y is still that cell's bottom here).
      doc.font('Helvetica').fontSize(7.5).fillColor(RX_THEME.muted);
      doc.text(subline, columnX(1) + CELL_PAD, doc.y + 2, { width });
    }
  });
  doc
    .moveTo(RX_PAGE.margin, y + height)
    .lineTo(RX_PAGE.margin + pageWidth(doc), y + height)
    .lineWidth(0.5)
    .stroke(RX_THEME.rule);
}

function drawRxHeading(doc: PdfDoc, y: number): number {
  doc
    .font('Times-BoldItalic')
    .fontSize(26)
    .fillColor(RX_THEME.brand)
    .text('Rx', RX_PAGE.margin, y, { lineBreak: false });
  label(doc, 'Medicines', RX_PAGE.margin + 34, y + 12, 120);
  return y + 32;
}

export function drawMedicines(
  doc: PdfDoc,
  items: readonly PrescriptionPdfItem[],
  y: number
): number {
  let cursor = drawTableHeader(
    doc,
    drawRxHeading(doc, ensureSpace(doc, y, 32 + HEADER_HEIGHT + 30))
  );
  if (items.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(RX_THEME.muted);
    doc.text('No medicines on this prescription.', RX_PAGE.margin + CELL_PAD, cursor + CELL_PAD);
    return doc.y + 14;
  }
  items.forEach((item, index) => {
    const height = measureRow(doc, rowCells(item, index), medicineSubline(item));
    if (cursor + height > contentBottom(doc)) {
      cursor = drawTableHeader(doc, newPage(doc));
    }
    drawRow(doc, item, index, cursor, height);
    cursor += height;
  });
  return cursor + 16;
}

// ------------------------------------------------------------------ advice, investigations, follow-up

/** Advice lines: one per non-empty line, list markers stripped. */
export function adviceLines(notes?: string | null): readonly string[] {
  return clean(notes)
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
}

export function drawBulletSection(
  doc: PdfDoc,
  title: string,
  lines: readonly string[],
  y: number
): number {
  if (lines.length === 0) return y;
  const width = pageWidth(doc) - 12;
  let cursor = ensureSpace(doc, y, 30);
  label(doc, title, RX_PAGE.margin, cursor, width);
  cursor += 13;
  lines.forEach(line => {
    doc.font('Helvetica').fontSize(9.5);
    cursor = ensureSpace(doc, cursor, doc.heightOfString(line, { width }) + 3);
    doc.circle(RX_PAGE.margin + 3, cursor + 4.5, 1.6).fill(RX_THEME.brand);
    doc.fillColor(RX_THEME.ink).text(line, RX_PAGE.margin + 12, cursor, { width });
    cursor = doc.y + 3;
  });
  return cursor + 10;
}

export function investigationLines(
  investigations?: readonly PrescriptionPdfInvestigation[] | null
): readonly string[] {
  return (investigations ?? [])
    .map(entry => {
      const name = clean(entry.name);
      const urgency = clean(entry.urgency).toUpperCase();
      return name && urgency && urgency !== 'ROUTINE' ? `${name} (${urgency.toLowerCase()})` : name;
    })
    .filter(Boolean);
}

function drawCalendarIcon(doc: PdfDoc, x: number, y: number): void {
  doc.save();
  doc
    .roundedRect(x, y + 2, 16, 15, 2.5)
    .lineWidth(1.3)
    .stroke(RX_THEME.brand);
  doc.rect(x, y + 2, 16, 4.5).fill(RX_THEME.brand);
  doc
    .moveTo(x + 4.5, y)
    .lineTo(x + 4.5, y + 4)
    .moveTo(x + 11.5, y)
    .lineTo(x + 11.5, y + 4)
    .lineWidth(1.3)
    .stroke(RX_THEME.brand);
  doc
    .circle(x + 5, y + 11, 1)
    .circle(x + 8, y + 11, 1)
    .circle(x + 11, y + 11, 1)
    .fill(RX_THEME.brand);
  doc.restore();
}

export function drawFollowUp(
  doc: PdfDoc,
  followUp: PrescriptionPdfFollowUp | null | undefined,
  y: number
): number {
  if (!followUp) return y;
  const date = formatDateInIST(followUp.scheduledFor);
  if (!date) return y;
  const width = pageWidth(doc);
  const detail = [clean(followUp.followUpType), clean(followUp.instructions)]
    .filter(Boolean)
    .join(' · ');
  doc.font('Helvetica').fontSize(8.5);
  const detailHeight = detail ? doc.heightOfString(detail, { width: width - 52 }) + 2 : 0;
  const height = 30 + detailHeight;
  const top = ensureSpace(doc, y, height + 4);
  doc
    .roundedRect(RX_PAGE.margin, top, width, height, 8)
    .fillAndStroke(RX_THEME.followUpFill, RX_THEME.followUpStroke);
  drawCalendarIcon(doc, RX_PAGE.margin + 14, top + 7);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(RX_THEME.brandDark);
  doc.text(`Follow-up on ${date}`, RX_PAGE.margin + 40, top + 10, { width: width - 52 });
  if (detail) {
    doc.font('Helvetica').fontSize(8.5).fillColor(RX_THEME.muted);
    doc.text(detail, RX_PAGE.margin + 40, doc.y + 2, { width: width - 52 });
  }
  return top + height + 12;
}
