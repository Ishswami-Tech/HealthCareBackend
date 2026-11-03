import PDFDocument from 'pdfkit';
import { formatDateInIST } from '@utils/date-time.util';
import type { PrescriptionPdfData } from '@services/pharmacy/services/prescription-pdf.types';
import {
  adviceLines,
  drawBulletSection,
  drawDiagnosis,
  drawFollowUp,
  drawLetterhead,
  drawMedicines,
  drawPatientGrid,
  ensureSpace,
  investigationLines,
  pageWidth,
  RX_PAGE,
  RX_THEME,
  type PdfDoc,
} from '@services/pharmacy/services/prescription-pdf.sections';
import {
  buildVerificationQr,
  decoratePages,
  drawFooter,
} from '@services/pharmacy/services/prescription-pdf.footer';

export type {
  PrescriptionPdfData,
  PrescriptionPdfFollowUp,
  PrescriptionPdfInvestigation,
  PrescriptionPdfItem,
} from '@services/pharmacy/services/prescription-pdf.types';

function drawValidUntil(
  doc: PdfDoc,
  validUntil: PrescriptionPdfData['validUntil'],
  y: number
): number {
  const date = validUntil ? formatDateInIST(validUntil) : '';
  if (!date) return y;
  const top = ensureSpace(doc, y, 14);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(RX_THEME.muted);
  doc.text(`Valid until ${date}`, RX_PAGE.margin, top, { width: pageWidth(doc) });
  return doc.y + 8;
}

function drawBody(doc: PdfDoc, data: PrescriptionPdfData): number {
  let y = drawLetterhead(doc, data, RX_PAGE.margin);
  y = drawPatientGrid(doc, data, y);
  y = drawDiagnosis(doc, data.diagnosis, y);
  y = drawMedicines(doc, data.items, y);
  y = drawBulletSection(doc, 'Advice', adviceLines(data.notes), y);
  y = drawBulletSection(doc, 'Investigations', investigationLines(data.investigations), y);
  y = drawFollowUp(doc, data.followUp, y);
  return drawValidUntil(doc, data.validUntil, y);
}

/**
 * Prescription PDF on a clinic letterhead (A4 portrait): clinic + doctor header, patient grid,
 * diagnosis, medicines table (header repeated on every page), advice, investigations, follow-up,
 * verification QR + prescriber footer (digital prescription: no signature). DRAFT / RETURNED
 * prescriptions get no QR. Rendered fully in memory; nothing is written to disk.
 */
export async function buildPrescriptionPdf(data: PrescriptionPdfData): Promise<Buffer> {
  const qr = await buildVerificationQr(data);
  const generatedAt = data.generatedAt ?? new Date();
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      bufferPages: true,
      // A small bottom margin so the reference line can sit below the content area; the
      // content itself stops at contentBottom() (see prescription-pdf.sections.ts).
      margins: { top: RX_PAGE.margin, left: RX_PAGE.margin, right: RX_PAGE.margin, bottom: 12 },
      info: { Title: `Prescription ${data.prescriptionNumber}`, Author: data.clinicName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (error: Error) => reject(error));
    try {
      const y = drawBody(doc, data);
      drawFooter(doc, data, qr, y);
      decoratePages(doc, data, generatedAt);
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
