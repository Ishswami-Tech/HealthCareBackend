import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import type { InvoicePDFData } from '@core/types/billing.types';

type InvoiceStatusKind = 'PAID' | 'PENDING' | 'OVERDUE' | 'DRAFT' | 'CANCELLED';
type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

@Injectable()
export class InvoicePDFService {
  private readonly invoicesDir: string;

  private readonly palette = {
    green1: '#4caf82',
    green2: '#7dcfaa',
    green3: '#b8ecd4',
    green4: '#e6f9f1',
    teal: '#3bbfa3',
    blue: '#5bb8d4',
    purple: '#9b8de8',
    peach: '#f4a96a',
    yellow: '#f6d45a',
    ink: '#1e3a2f',
    muted: '#6b8f7e',
    border: '#c8edd9',
    white: '#ffffff',
    paid: '#27ae72',
    paidBg: '#d4f5e5',
    pending: '#d97706',
    overdue: '#dc2626',
    draft: '#6b7280',
    cancelled: '#8b8b8b',
  } as const;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    const storageDir = path.join(process.cwd(), 'storage', 'invoices');
    const tmpDir = path.join('/tmp', 'invoices');

    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true, mode: 0o755 });
      }
      this.invoicesDir = storageDir;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Could not create storage directory at ${storageDir}, using /tmp as fallback`,
        'InvoicePDFService',
        { storageDir, error: error instanceof Error ? error.message : 'Unknown error' }
      );

      try {
        if (!fs.existsSync(tmpDir)) {
          fs.mkdirSync(tmpDir, { recursive: true, mode: 0o755 });
        }
        this.invoicesDir = tmpDir;
      } catch (tmpError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to create fallback directory at ${tmpDir}`,
          'InvoicePDFService',
          { tmpDir, error: tmpError instanceof Error ? tmpError.message : 'Unknown error' }
        );
        this.invoicesDir = process.cwd();
      }
    }
  }

  /**
   * Generate a polished invoice PDF that follows the branded layout from the
   * provided sample while still using the real invoice data.
   */
  async generateInvoicePDF(data: InvoicePDFData): Promise<{ filePath: string; fileName: string }> {
    try {
      const fileName = `invoice_${data.invoiceNumber}_${Date.now()}.pdf`;
      const filePath = path.join(this.invoicesDir, fileName);

      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        bufferPages: true,
        info: {
          Title: `Invoice ${data.invoiceNumber}`,
          Author: data.clinicName,
          Subject: 'Healthcare invoice',
        },
      });

      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      this.renderInvoice(doc, data);
      doc.end();

      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Invoice PDF generated successfully: ${fileName}`,
        'InvoicePDFService',
        { fileName, invoiceNumber: data.invoiceNumber }
      );

      return { filePath, fileName };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'InvoicePDFService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  private renderInvoice(doc: PDFDocumentInstance, data: InvoicePDFData): void {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    this.drawPageBackground(doc, pageWidth, pageHeight);
    this.drawCornerOrnaments(doc);
    this.drawRainbowBar(doc);
    this.drawHeader(doc, data);
    this.drawSummaryCards(doc, data);

    const serviceHeaderY = 310;
    const tableTop = serviceHeaderY + 26;
    const tableBottom = 575;
    this.drawSectionTitle(doc, serviceHeaderY, 'Services Rendered');
    const nextY = this.drawLineItemsTable(doc, data, tableTop, tableBottom);

    const totalsY = Math.max(nextY + 18, 300);
    this.drawTotalsAndPayment(doc, data, totalsY);
    this.drawNotes(doc, data, totalsY + 264);
    this.drawFooter(doc, data, pageHeight);
  }

  private drawPageBackground(
    doc: PDFDocumentInstance,
    pageWidth: number,
    pageHeight: number
  ): void {
    doc.save();
    doc.rect(0, 0, pageWidth, pageHeight).fill('#f6fbf9');
    doc.restore();
    doc.save();
    doc
      .rect(16, 16, pageWidth - 32, pageHeight - 32)
      .lineWidth(1)
      .stroke(this.palette.border);
    doc.restore();
  }

  private drawRainbowBar(doc: PDFDocumentInstance): void {
    const colors = [
      this.palette.green1,
      this.palette.teal,
      this.palette.blue,
      this.palette.purple,
      this.palette.peach,
      this.palette.yellow,
    ];
    const segmentWidth = doc.page.width / colors.length;

    colors.forEach((color, index) => {
      doc.rect(index * segmentWidth, 0, segmentWidth + 1, 6).fill(color);
    });
  }

  private drawCornerOrnaments(doc: PDFDocumentInstance): void {
    const stroke = this.palette.green1;
    doc.save();
    doc.lineWidth(2.5).strokeColor(stroke);
    doc.moveTo(18, 18).lineTo(64, 18).stroke();
    doc.moveTo(18, 18).lineTo(18, 64).stroke();
    doc.lineWidth(1.5).strokeColor(this.palette.teal);
    doc.moveTo(28, 18).lineTo(28, 28).lineTo(18, 28).stroke();
    doc.circle(18, 18, 3.5).fill(stroke);
    doc.restore();

    doc.save();
    doc.translate(doc.page.width - 18, doc.page.height - 18);
    doc.rotate(180);
    doc.lineWidth(2.5).strokeColor(stroke);
    doc.moveTo(0, 0).lineTo(46, 0).stroke();
    doc.moveTo(0, 0).lineTo(0, 46).stroke();
    doc.lineWidth(1.5).strokeColor(this.palette.teal);
    doc.moveTo(10, 0).lineTo(10, 10).lineTo(0, 10).stroke();
    doc.circle(0, 0, 3.5).fill(stroke);
    doc.restore();
  }

  private drawHeader(doc: PDFDocumentInstance, data: InvoicePDFData): void {
    const status = this.getNormalizedStatus(data.status);
    const isPaid = status === 'PAID';
    const headerY = 34;

    doc.save();
    doc
      .roundedRect(32, 26, doc.page.width - 64, 184, 18)
      .fillAndStroke('#eafaf3', this.palette.border);
    doc.restore();

    doc.save();
    doc
      .roundedRect(32, 26, doc.page.width - 64, 184, 18)
      .fillOpacity(0.12)
      .fill('#e4f4fb');
    doc.restore();

    doc.save();
    doc
      .roundedRect(32, 26, doc.page.width - 64, 184, 18)
      .lineWidth(1.5)
      .stroke(this.palette.border);
    doc.restore();

    this.drawLogoPill(doc, 54, headerY + 10, data.clinicName);

    doc
      .font('Times-Bold')
      .fontSize(22)
      .fillColor(this.palette.ink)
      .text(data.clinicName, 54, headerY + 42, { width: 310 });

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.palette.teal)
      .text('Ancient Wisdom  Modern Care', 54, headerY + 72, {
        characterSpacing: 1.4,
        width: 250,
      });

    const contactLines = [
      data.clinicAddress,
      data.clinicPhone ? `Phone: ${data.clinicPhone}` : undefined,
      data.clinicEmail ? `Email: ${data.clinicEmail}` : undefined,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(this.palette.muted)
      .text(contactLines.join('\n'), 54, headerY + 94, {
        width: 330,
        lineGap: 4,
      });

    const rightX = 408;
    doc
      .roundedRect(rightX, headerY + 2, 70, 22, 11)
      .fillAndStroke(this.palette.green1, this.palette.green1);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(this.palette.white)
      .text('INVOICE', rightX, headerY + 7, { width: 70, align: 'center' });

    doc
      .font('Times-Bold')
      .fontSize(22)
      .fillColor(this.palette.ink)
      .text(data.invoiceNumber, rightX, headerY + 28, {
        width: 300,
        align: 'right',
      });

    this.drawDatePill(doc, rightX + 125, headerY + 74, 'Issue', this.formatDate(data.invoiceDate));
    this.drawDatePill(doc, rightX + 125, headerY + 100, 'Due', this.formatDate(data.dueDate));

    const badgeText = isPaid ? 'PAID' : status;
    const badgeColor = this.getStatusColors(status);
    doc
      .roundedRect(rightX + 128, headerY + 132, 112, 26, 13)
      .fillAndStroke(badgeColor.bg, badgeColor.border);
    doc.circle(rightX + 144, headerY + 145, 4).fill(badgeColor.dot);
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(badgeColor.text)
      .text(badgeText, rightX + 154, headerY + 138, {
        width: 74,
        align: 'left',
        characterSpacing: 1.1,
      });
  }

  private drawLogoPill(doc: PDFDocumentInstance, x: number, y: number, clinicName: string): void {
    const logoText = this.getClinicShortName(clinicName);
    doc.roundedRect(x, y, 130, 30, 15).fillAndStroke(this.palette.white, this.palette.green3);
    doc
      .roundedRect(x + 6, y + 4, 22, 22, 11)
      .fillAndStroke(this.palette.green1, this.palette.green1);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.palette.white)
      .text('✿', x + 6, y + 8, { width: 22, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.palette.green1)
      .text(logoText.toUpperCase(), x + 36, y + 9, {
        width: 82,
        characterSpacing: 1,
      });
  }

  private drawDatePill(
    doc: PDFDocumentInstance,
    x: number,
    y: number,
    label: string,
    value: string
  ): void {
    const width = 145;
    doc.roundedRect(x, y, width, 20, 10).fillAndStroke(this.palette.white, this.palette.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(this.palette.ink)
      .text(`${label}:`, x + 10, y + 6, { width: 35 });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(this.palette.muted)
      .text(value, x + 48, y + 6, { width: width - 56, align: 'right' });
  }

  private drawSummaryCards(doc: PDFDocumentInstance, data: InvoicePDFData): void {
    const cardY = 226;
    const cardHeight = 64;
    const cardWidth = (doc.page.width - 96) / 3;
    const gap = 12;
    const xPositions: [number, number, number] = [
      32,
      32 + cardWidth + gap,
      32 + (cardWidth + gap) * 2,
    ];

    const serviceType =
      data.subscriptionPlan || this.guessPrimaryService(data.lineItems) || 'Video Consultation';

    const cards = [
      {
        label: 'Billed To',
        title: data.userName,
        sub: [data.userEmail, data.userPhone, data.userAddress]
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .join('\n'),
        accent: this.palette.green1,
      },
      {
        label: 'Service Type',
        title: serviceType,
        sub: data.subscriptionPeriod || `${data.lineItems.length} line item(s)`,
        accent: this.palette.teal,
      },
      {
        label: 'Facility',
        title: data.clinicName,
        sub: data.clinicAddress || 'Healthcare facility',
        accent: this.palette.purple,
      },
    ];

    cards.forEach((card, index) => {
      const x = xPositions[index as 0 | 1 | 2];
      doc
        .roundedRect(x, cardY, cardWidth, cardHeight, 12)
        .fillAndStroke(this.palette.white, this.palette.border);
      doc.rect(x, cardY, cardWidth, 4).fill(card.accent);
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(card.accent)
        .text(card.label.toUpperCase(), x + 14, cardY + 12, {
          width: cardWidth - 28,
          characterSpacing: 1.4,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(this.palette.ink)
        .text(card.title, x + 14, cardY + 27, {
          width: cardWidth - 28,
          height: 18,
          ellipsis: true,
        });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(this.palette.muted)
        .text(card.sub, x + 14, cardY + 44, {
          width: cardWidth - 28,
          height: 18,
          lineGap: 2,
          ellipsis: true,
        });
    });
  }

  private drawSectionTitle(doc: PDFDocumentInstance, y: number, title: string): void {
    doc
      .roundedRect(32, y, doc.page.width - 64, 24, 10)
      .fillAndStroke('#f3faf7', this.palette.border);
    doc.circle(48, y + 12, 4).fill(this.palette.green1);
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(this.palette.teal)
      .text(title.toUpperCase(), 60, y + 8, { characterSpacing: 1.5 });
  }

  private drawLineItemsTable(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    topY: number,
    bottomY: number
  ): number {
    const leftX = 32;
    const colWidths = {
      description: 298,
      qty: 70,
      unit: 100,
      amount: 110,
    };
    const tableWidth = colWidths.description + colWidths.qty + colWidths.unit + colWidths.amount;

    doc
      .roundedRect(leftX, topY, tableWidth, 34, 12)
      .fillAndStroke(this.palette.white, this.palette.border);
    doc.rect(leftX, topY, tableWidth, 34).fill('#4caf82');

    doc
      .font('Helvetica-Bold')
      .fontSize(9.2)
      .fillColor(this.palette.white)
      .text('Description', leftX + 16, topY + 12, { width: colWidths.description - 20 });
    doc
      .text('Qty', leftX + colWidths.description + 4, topY + 12, {
        width: colWidths.qty - 8,
        align: 'right',
      })
      .text('Unit Price', leftX + colWidths.description + colWidths.qty + 4, topY + 12, {
        width: colWidths.unit - 8,
        align: 'right',
      })
      .text(
        'Amount',
        leftX + colWidths.description + colWidths.qty + colWidths.unit + 4,
        topY + 12,
        {
          width: colWidths.amount - 20,
          align: 'right',
        }
      );

    let currentY = topY + 34;

    if (data.lineItems.length === 0) {
      this.drawLineItemRow(
        doc,
        {
          description: 'Invoice item',
          quantity: 1,
          amount: data.total,
        },
        currentY,
        {
          leftX,
          colWidths,
          tableWidth,
        }
      );
      currentY += 56;
      return currentY;
    }

    data.lineItems.forEach((item, index) => {
      const rowHeight = this.getLineItemRowHeight(doc, item, colWidths.description);
      const needsPageBreak = currentY + rowHeight > bottomY;
      if (needsPageBreak) {
        doc.addPage({ size: 'A4', margin: 0 });
        this.drawPageBackground(doc, doc.page.width, doc.page.height);
        this.drawTopCompactHeader(doc, data);
        currentY = 110;
      }

      this.drawLineItemRow(doc, item, currentY, {
        leftX,
        colWidths,
        tableWidth,
        rowIndex: index + 1,
      });
      currentY += rowHeight;
    });

    doc.roundedRect(leftX, currentY, tableWidth, 1, 0).fill(this.palette.border);

    return currentY;
  }

  private drawTopCompactHeader(doc: PDFDocumentInstance, data: InvoicePDFData): void {
    const titleY = 28;
    doc
      .roundedRect(32, 24, doc.page.width - 64, 70, 14)
      .fillAndStroke('#edf9f3', this.palette.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.palette.teal)
      .text('INVOICE', 48, titleY, { characterSpacing: 1.6 });
    doc
      .font('Times-Bold')
      .fontSize(18)
      .fillColor(this.palette.ink)
      .text(data.invoiceNumber, 48, titleY + 16);
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(this.palette.muted)
      .text(`${data.clinicName}  •  ${this.formatDate(data.invoiceDate)}`, 48, titleY + 38);
  }

  private drawLineItemRow(
    doc: PDFDocumentInstance,
    item: InvoicePDFData['lineItems'][number],
    y: number,
    layout: {
      leftX: number;
      colWidths: {
        description: number;
        qty: number;
        unit: number;
        amount: number;
      };
      tableWidth: number;
      rowIndex?: number;
    }
  ): void {
    const { leftX, colWidths, tableWidth, rowIndex } = layout;
    const rowHeight = this.getLineItemRowHeight(doc, item, colWidths.description);
    const fillColor = rowIndex && rowIndex % 2 === 0 ? this.palette.green4 : this.palette.white;

    doc
      .roundedRect(leftX, y, tableWidth, rowHeight, 0)
      .fillAndStroke(fillColor, this.palette.border);

    const descriptionText = item.description || 'Service';
    const quantityText = String(item.quantity ?? 1);
    const unitText = item.unitPrice !== undefined ? this.formatMoney(item.unitPrice) : '-';
    const amountText = this.formatMoney(item.amount);

    doc
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .fillColor(this.palette.ink)
      .text(descriptionText, leftX + 14, y + 12, {
        width: colWidths.description - 24,
        height: rowHeight - 18,
      });

    const tag =
      item.description.includes('video') || item.description.includes('call')
        ? 'VIDEO_CALL'
        : 'SERVICE';
    doc
      .roundedRect(leftX + 14, y + rowHeight - 20, 78, 14, 7)
      .fillAndStroke('#e4f8f0', this.palette.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(7.7)
      .fillColor(this.palette.teal)
      .text(tag, leftX + 14, y + rowHeight - 16, { width: 78, align: 'center' });

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.palette.ink)
      .text(quantityText, leftX + colWidths.description + 4, y + 16, {
        width: colWidths.qty - 8,
        align: 'right',
      })
      .text(unitText, leftX + colWidths.description + colWidths.qty + 4, y + 16, {
        width: colWidths.unit - 8,
        align: 'right',
      })
      .text(
        amountText,
        leftX + colWidths.description + colWidths.qty + colWidths.unit + 4,
        y + 16,
        {
          width: colWidths.amount - 16,
          align: 'right',
        }
      );
  }

  private getLineItemRowHeight(
    doc: PDFDocumentInstance,
    item: InvoicePDFData['lineItems'][number],
    width: number
  ): number {
    const descriptionHeight = doc.heightOfString(item.description || 'Service', {
      width: width - 24,
      lineGap: 2,
    });
    return Math.max(52, Math.ceil(descriptionHeight) + 34);
  }

  private drawTotalsAndPayment(doc: PDFDocumentInstance, data: InvoicePDFData, y: number): void {
    const totalsX = doc.page.width - 334;
    const totalsWidth = 302;
    const status = this.getNormalizedStatus(data.status);
    const statusColors = this.getStatusColors(status);

    doc
      .roundedRect(totalsX, y, totalsWidth, 124, 14)
      .fillAndStroke(this.palette.white, this.palette.border);

    this.drawTotalsRow(
      doc,
      totalsX,
      y + 12,
      totalsWidth,
      'Subtotal',
      this.formatMoney(data.subtotal)
    );
    this.drawTotalsRow(doc, totalsX, y + 36, totalsWidth, 'Tax / GST', this.formatMoney(data.tax));
    this.drawTotalsRow(
      doc,
      totalsX,
      y + 60,
      totalsWidth,
      'Discount',
      data.discount > 0 ? `-${this.formatMoney(data.discount)}` : this.formatMoney(0)
    );

    doc.roundedRect(totalsX, y + 84, totalsWidth, 34, 0).fillAndStroke('#4caf82', '#4caf82');
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(this.palette.white)
      .text('TOTAL AMOUNT', totalsX + 14, y + 97, { characterSpacing: 1.2 });
    doc
      .font('Times-Bold')
      .fontSize(20)
      .fillColor(this.palette.white)
      .text(this.formatMoney(data.total), totalsX + 150, y + 93, {
        width: 132,
        align: 'right',
      });

    const paymentX = 32;
    const paymentWidth = 272;
    doc
      .roundedRect(paymentX, y, paymentWidth, 124, 14)
      .fillAndStroke('#eafaf3', this.palette.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(this.palette.teal)
      .text('PAYMENT DETAILS', paymentX + 16, y + 14, { characterSpacing: 1.4 });

    const paymentItems = [
      { label: 'Payment Date', value: data.paidAt ? this.formatDate(data.paidAt) : '--' },
      { label: 'Transaction ID', value: data.transactionId || data.invoiceNumber },
      {
        label: 'Amount Paid',
        value: data.paidAt ? this.formatMoney(data.total) : this.formatMoney(0),
      },
      { label: 'Status', value: status, valueColor: statusColors.text },
    ];

    const leftColX = paymentX + 16;
    const rightColX = paymentX + 140;

    paymentItems.forEach((entry, index) => {
      const columnX = index % 2 === 0 ? leftColX : rightColX;
      const rowY = y + 32 + Math.floor(index / 2) * 32;
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(this.palette.muted)
        .text(entry.label.toUpperCase(), columnX, rowY, { width: 106, characterSpacing: 0.7 });
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(entry.valueColor || this.palette.ink)
        .text(entry.value, columnX, rowY + 12, { width: 106 });
    });

    const journeyX = 32;
    const journeyWidth = doc.page.width - 64;
    doc.roundedRect(journeyX, y + 134, journeyWidth, 118, 14).fillAndStroke('#ede9ff', '#d0c8f8');
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(this.palette.purple)
      .text('PAYMENT JOURNEY', journeyX + 16, y + 144, { characterSpacing: 1.4 });

    const journey = this.buildJourney(status, !!data.paidAt);
    const startX = journeyX + 18;
    const stepYs: [number, number, number] = [y + 164, y + 192, y + 220];

    journey.steps.forEach((step, index) => {
      const stepY = stepYs[index as 0 | 1 | 2];
      doc.circle(startX + 7, stepY + 2, 7).fill(step.color);
      doc
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .fillColor(this.palette.ink)
        .text(step.label, startX + 24, stepY - 2, { width: journeyWidth - 58 });

      if (index < journey.steps.length - 1) {
        const nextStepY = stepYs[(index + 1) as 1 | 2];
        doc
          .moveTo(startX + 7, stepY + 16)
          .lineTo(startX + 7, nextStepY - 6)
          .lineWidth(1)
          .stroke('#c8edd9');
      }
    });

    const journeyStatus = journey.note;
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(this.palette.muted)
      .text(journeyStatus, journeyX + 16, y + 236, {
        width: journeyWidth - 32,
      });
  }

  private drawTotalsRow(
    doc: PDFDocumentInstance,
    x: number,
    y: number,
    width: number,
    label: string,
    value: string
  ): void {
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(this.palette.muted)
      .text(label, x + 14, y, { width: width - 28 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(this.palette.ink)
      .text(value, x + 146, y, { width: width - 160, align: 'right' });
  }

  private drawNotes(doc: PDFDocumentInstance, data: InvoicePDFData, y: number): void {
    const noteText =
      data.notes ||
      `Thank you for choosing ${data.clinicName}. This invoice covers services rendered on ${this.formatDate(data.invoiceDate)}. Payment is due within 30 days. Please include the invoice number with any correspondence.`;
    const termsText =
      data.termsAndConditions ||
      'Thank you for your business. Payment is due within 30 days. Please include the invoice number with your payment.';

    doc.roundedRect(32, y, doc.page.width - 64, 80, 12).fillAndStroke('#fff9ec', '#f6d45a');
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#c8961a')
      .text('NOTES', 48, y + 12, { characterSpacing: 1.4 });
    doc
      .font('Times-Italic')
      .fontSize(12)
      .fillColor('#a07a30')
      .text(noteText, 48, y + 26, {
        width: doc.page.width - 96,
        lineGap: 3,
      });

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(this.palette.muted)
      .text(termsText, 48, y + 62, {
        width: doc.page.width - 96,
        align: 'center',
      });
  }

  private drawFooter(doc: PDFDocumentInstance, data: InvoicePDFData, pageHeight: number): void {
    const footerY = pageHeight - 46;
    doc.rect(0, footerY - 3, doc.page.width, 3).fill(this.palette.green1);
    doc.rect(0, footerY, doc.page.width, 46).fill('#eafaf3');

    doc
      .font('Times-Bold')
      .fontSize(14)
      .fillColor(this.palette.green1)
      .text(data.clinicName, 48, footerY + 13);

    doc
      .roundedRect(doc.page.width - 196, footerY + 10, 128, 22, 11)
      .fillAndStroke(this.palette.white, this.palette.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(this.palette.teal)
      .text('Pune, Maharashtra', doc.page.width - 196, footerY + 17, {
        width: 128,
        align: 'center',
      });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(this.palette.muted)
      .text('Page 1 of 1', doc.page.width - 98, footerY + 17, {
        width: 48,
        align: 'right',
      });
  }

  private getStatusColors(status: InvoiceStatusKind): {
    bg: string;
    border: string;
    text: string;
    dot: string;
  } {
    switch (status) {
      case 'PAID':
        return {
          bg: this.palette.paidBg,
          border: '#74c69d',
          text: this.palette.paid,
          dot: this.palette.paid,
        };
      case 'OVERDUE':
        return {
          bg: '#fee2e2',
          border: '#fca5a5',
          text: this.palette.overdue,
          dot: this.palette.overdue,
        };
      case 'CANCELLED':
        return {
          bg: '#f3f4f6',
          border: '#d1d5db',
          text: this.palette.cancelled,
          dot: this.palette.cancelled,
        };
      case 'DRAFT':
        return {
          bg: '#f3f4f6',
          border: '#d1d5db',
          text: this.palette.draft,
          dot: this.palette.draft,
        };
      case 'PENDING':
      default:
        return {
          bg: '#fffbeb',
          border: '#fcd34d',
          text: this.palette.pending,
          dot: this.palette.pending,
        };
    }
  }

  private buildJourney(
    status: InvoiceStatusKind,
    isPaid: boolean
  ): { steps: Array<{ label: string; color: string }>; note: string } {
    const paid = this.palette.paid;
    const active = this.palette.green1;
    const muted = '#cbd5e1';

    const paidJourney = {
      steps: [
        { label: 'Appointment Booked', color: paid },
        { label: 'Consultation Completed', color: paid },
        { label: 'Payment Received', color: active },
      ],
      note: 'Payment has been recorded and the invoice is settled.',
    };

    const pendingJourney = {
      steps: [
        { label: 'Appointment Booked', color: paid },
        { label: 'Consultation Completed', color: isPaid ? paid : active },
        { label: 'Payment Received', color: isPaid ? active : muted },
      ],
      note: isPaid ? 'Payment is complete.' : 'Invoice is waiting for payment or settlement.',
    };

    if (status === 'PAID' || isPaid) {
      return paidJourney;
    }

    return pendingJourney;
  }

  private getNormalizedStatus(status: string): InvoiceStatusKind {
    const normalized = status.trim().toUpperCase();
    if (
      normalized === 'PAID' ||
      normalized === 'PENDING' ||
      normalized === 'OVERDUE' ||
      normalized === 'DRAFT' ||
      normalized === 'CANCELLED'
    ) {
      return normalized;
    }
    return 'PENDING';
  }

  private guessPrimaryService(lineItems: InvoicePDFData['lineItems']): string | undefined {
    if (!lineItems.length) {
      return undefined;
    }
    const first = lineItems[0]?.description?.trim();
    if (!first) {
      return undefined;
    }
    return first;
  }

  private getClinicShortName(clinicName: string): string {
    const parts = clinicName.trim().split(/\s+/).filter(Boolean);
    return parts
      .slice(0, 2)
      .map(part => part[0] ?? '')
      .join('');
  }

  private formatMoney(amount: number): string {
    return Number(amount || 0).toFixed(2);
  }

  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  getPublicInvoiceUrl(fileName: string): string {
    const appConfig = this.configService.getAppConfig();
    const baseUrl =
      appConfig.apiUrl ||
      appConfig.baseUrl ||
      this.configService.getEnv('API_URL') ||
      this.configService.getEnv('BASE_URL');

    if (!baseUrl) {
      throw new Error(
        'Missing API_URL or BASE_URL environment variable. Cannot generate invoice download URL without base URL.'
      );
    }

    return `${baseUrl}/api/v1/billing/invoices/download/${fileName}`;
  }

  deleteInvoicePDF(fileName: string): void {
    try {
      const filePath = path.join(this.invoicesDir, fileName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          `Invoice PDF deleted: ${fileName}`,
          'InvoicePDFService',
          { fileName }
        );
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'InvoicePDFService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  invoicePDFExists(fileName: string): boolean {
    const filePath = path.join(this.invoicesDir, fileName);
    return fs.existsSync(filePath);
  }

  getInvoiceFilePath(fileName: string): string {
    return path.join(this.invoicesDir, fileName);
  }
}
