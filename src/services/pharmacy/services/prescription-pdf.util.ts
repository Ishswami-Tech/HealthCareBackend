import PDFDocument from 'pdfkit';
import { formatDateInIST } from '@utils/date-time.util';

export interface PrescriptionPdfItem {
  readonly medicineName: string;
  readonly quantity: number;
  readonly dosage?: string | null;
  readonly frequency?: string | null;
  readonly duration?: string | null;
  readonly unit?: string | null;
}

export interface PrescriptionPdfData {
  readonly prescriptionNumber: string;
  readonly clinicName: string;
  readonly prescribedAt: Date | string | null;
  readonly patientName: string;
  readonly patientAge?: number | null;
  readonly patientGender?: string | null;
  readonly patientNumber?: string | null;
  readonly doctorName: string;
  readonly diagnosis?: string | null;
  readonly notes?: string | null;
  readonly status: string;
  readonly items: readonly PrescriptionPdfItem[];
}

const ACCENT = '#0F766E';
const MUTED = '#64748B';

/**
 * Minimal prescription PDF (no existing prescription PDF generator in the repo; the
 * invoice generator in billing/invoice-pdf.service.ts is invoice specific, so only the
 * `pdfkit` dependency is shared). Rendered fully in memory, nothing is written to disk.
 */
export function buildPrescriptionPdf(data: PrescriptionPdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (error: Error) => reject(error));

    doc.fillColor(ACCENT).fontSize(20).text(data.clinicName, { align: 'left' });
    doc.fillColor(MUTED).fontSize(10).text('Prescription', { align: 'left' });
    doc.moveDown(0.5);
    doc
      .fillColor('#0F172A')
      .fontSize(11)
      .text(`Prescription No: ${data.prescriptionNumber}`)
      .text(`Date: ${data.prescribedAt ? formatDateInIST(data.prescribedAt) : '-'}`)
      .text(`Status: ${data.status}`);
    doc.moveDown(0.5);

    const patientBits = [
      data.patientName,
      typeof data.patientAge === 'number' ? `${data.patientAge} yrs` : null,
      data.patientGender ?? null,
    ].filter((bit): bit is string => Boolean(bit));
    doc.text(`Patient: ${patientBits.join(', ')}`);
    if (data.patientNumber) {
      doc.text(`Patient No: ${data.patientNumber}`);
    }
    doc.text(`Doctor: ${data.doctorName}`);
    if (data.diagnosis) {
      doc.moveDown(0.5).text(`Diagnosis: ${data.diagnosis}`);
    }

    doc.moveDown();
    doc.fillColor(ACCENT).fontSize(13).text('Medicines');
    doc.moveDown(0.3).fillColor('#0F172A').fontSize(11);
    data.items.forEach((item, index) => {
      const qty = `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
      doc.text(`${index + 1}. ${item.medicineName}  x ${qty}`);
      const details = [item.dosage, item.frequency, item.duration].filter(Boolean).join(' | ');
      if (details) {
        doc.fillColor(MUTED).fontSize(10).text(`    ${details}`);
        doc.fillColor('#0F172A').fontSize(11);
      }
    });

    if (data.notes) {
      doc.moveDown().fillColor(ACCENT).fontSize(13).text('Notes');
      doc.moveDown(0.3).fillColor('#0F172A').fontSize(11).text(data.notes);
    }

    doc.end();
  });
}
