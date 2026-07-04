import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import type { InvoicePDFData } from '@core/types/billing.types';
import { formatDateInIST } from '../../libs/utils/date-time.util';

type PDFDocumentInstance = InstanceType<typeof PDFDocument>;

type NormalizedLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

@Injectable()
export class InvoicePDFService {
  private readonly invoicesDir: string;

  private readonly c = {
    accent: '#0D9488',
    accentLight: '#CCFBF1',
    accentDark: '#0F766E',
    textPrimary: '#134E4A',
    textSecondary: '#5EEAD4',
    dark: '#0F172A',
    gray: '#64748B',
    grayLight: '#94A3B8',
    surface: '#FFFFFF',
    surfaceAlt: '#F0FDFA',
    border: '#E2E8F0',
    bg: '#F1F5F9',
    paidBg: '#CCFBF1',
    paidText: '#0F766E',
    paidDot: '#0D9488',
    pendBg: '#FEF3C7',
    pendText: '#B45309',
    pendDot: '#F59E0B',
    overBg: '#FEE2E2',
    overText: '#B91C1C',
    overDot: '#EF4444',
    draftBg: '#F3F4F6',
    draftText: '#6B7280',
    draftDot: '#9CA3AF',
    white: '#FFFFFF',
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
    const startX = 32;
    const startY = 32;
    const contentW = pageWidth - 64;
    const footerHeight = 44;
    const footerReserve = footerHeight + 24;

    this.drawPageChrome(doc, startX, startY, contentW, pageHeight);

    let y = startY + 20;
    y = this.drawHeader(doc, data, startX + 28, y, contentW - 56);
    y += 10;
    y = this.drawInfoRow(doc, data, startX + 20, y, contentW - 40);
    y += 10;
    y = this.drawParties(doc, data, startX + 20, y, contentW - 40, footerReserve);
    y += 10;
    y = this.drawLineItems(doc, data, startX + 20, y, contentW - 40, footerReserve);
    y += 10;
    y = this.drawTotals(doc, data, startX + 20, y, contentW - 40, footerReserve);

    if (data.paidAt || data.paymentMethod || data.transactionId) {
      y += 10;
      y = this.drawPayment(doc, data, startX + 20, y, contentW - 40, footerReserve);
    }

    if (data.notes || data.termsAndConditions) {
      y += 10;
      this.drawNotesAndTerms(doc, data, startX + 20, y, contentW - 40, footerReserve);
    }

    this.drawFooter(doc, data, startX, pageHeight - 32 - footerHeight, contentW);
  }

  private drawPageChrome(
    doc: PDFDocumentInstance,
    startX: number,
    startY: number,
    contentW: number,
    pageHeight: number
  ): void {
    doc.rect(0, 0, doc.page.width, pageHeight).fill(this.c.bg);
    doc.roundedRect(startX, startY, contentW, pageHeight - 64, 12).fill(this.c.surface);

    const gradient = doc.linearGradient(startX, startY, startX + contentW, startY);
    gradient.stop(0, this.c.accent);
    gradient.stop(1, this.c.textSecondary);

    doc.save();
    doc.roundedRect(startX, startY, contentW, 12, 12).clip();
    doc.rect(startX, startY, contentW, 4).fill(gradient);
    doc.restore();
  }

  private addPageAndBackground(doc: PDFDocumentInstance): number {
    doc.addPage();
    this.drawPageChrome(doc, 32, 32, doc.page.width - 64, doc.page.height);
    return 52;
  }

  private drawHeader(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number
  ): number {
    const logoSize = 46;
    const initials = this.getClinicInitials(data.clinicName);
    const tagline =
      data.clinicName.toLowerCase().includes('clinic') ||
      data.clinicName.toLowerCase().includes('hospital')
        ? 'Traditional care, presented clearly'
        : 'Trusted care with clear records';

    doc.roundedRect(x, y, logoSize, logoSize, 12).fill(this.c.accent);
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(this.c.white)
      .text(initials, x, y + 14, { width: logoSize, align: 'center' });

    doc.font('Helvetica-Bold').fontSize(19);
    const clinicNameHeight = doc.heightOfString(data.clinicName, { width: w - 220 });
    doc.fillColor(this.c.dark).text(data.clinicName, x + 60, y + 2, { width: w - 220 });

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(this.c.gray)
      .text(tagline, x + 60, y + 2 + clinicNameHeight + 4, { width: w - 220 });

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(this.c.accent)
      .text('INVOICE SUMMARY', x + w - 150, y + 2, {
        width: 150,
        align: 'right',
        characterSpacing: 0.8,
      });
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor(this.c.dark)
      .text(`#${data.invoiceNumber}`, x + w - 210, y + 16, { width: 210, align: 'right' });

    if (data.gatewayOrderId) {
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(this.c.gray)
        .text(`Order Id: ${data.gatewayOrderId}`, x + w - 210, y + 44, {
          width: 210,
          align: 'right',
        });
    }

    doc.font('Helvetica-Bold').fontSize(19);
    const finalClinicNameHeight = doc.heightOfString(data.clinicName, { width: w - 220 });
    const contentY = y + 2 + finalClinicNameHeight + 4 + 14;
    return Math.max(y + 82, contentY + 16);
  }

  private drawInfoRow(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number
  ): number {
    const rowH = 46;
    doc.roundedRect(x, y, w, rowH, 10).fill(this.c.surfaceAlt);

    const statusInfo = this.getStatusInfo(data.status);
    const statusWidth = this.getStatusWidth(statusInfo.label);
    const badgeX = x + 18;
    const badgeY = y + 12;
    doc.roundedRect(badgeX, badgeY, statusWidth, 22, 11).fill(statusInfo.bg);
    doc.circle(badgeX + 12, badgeY + 11, 3).fill(statusInfo.dot);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor(statusInfo.text)
      .text(statusInfo.label, badgeX + 22, badgeY + 4, {
        width: statusWidth - 26,
        align: 'left',
        characterSpacing: 0.5,
      });

    const dateBlockX = x + w - 250;
    this.drawKeyValue(doc, 'Issued', this.formatDate(data.invoiceDate), dateBlockX, y + 10, 105);
    this.drawKeyValue(
      doc,
      data.paidAt ? 'Paid On' : 'Due',
      this.formatDate(data.paidAt ?? data.dueDate),
      dateBlockX + 118,
      y + 10,
      92
    );

    return y + rowH;
  }

  private drawParties(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number,
    footerReserve: number
  ): number {
    const leftDetails = this.buildPartyDetails([data.userEmail, data.userPhone, data.userAddress]);
    const rightDetails = this.buildPartyDetails([data.clinicAddress, data.clinicPhone]);
    const gap = 16;
    const cardW = (w - gap) / 2;

    const leftHeight = this.measurePartyCard(doc, data.userName, leftDetails, cardW);
    const rightHeight = this.measurePartyCard(doc, data.clinicName, rightDetails, cardW);
    const cardH = Math.max(leftHeight, rightHeight);

    if (y + cardH > doc.page.height - footerReserve) {
      y = this.addPageAndBackground(doc);
    }

    const leftX = x;
    const rightX = x + cardW + gap;

    this.drawPartyCard(doc, 'PATIENT DETAILS', data.userName, leftDetails, leftX, y, cardW, cardH);
    this.drawPartyCard(
      doc,
      'CLINIC DETAILS',
      data.clinicName,
      rightDetails,
      rightX,
      y,
      cardW,
      cardH
    );

    return y + cardH;
  }

  private buildPartyDetails(values: Array<string | undefined | null>): string[] {
    return values.map(value => String(value || '').trim()).filter(Boolean);
  }

  private measurePartyCard(
    doc: PDFDocumentInstance,
    name: string,
    details: string[],
    w: number
  ): number {
    doc.font('Helvetica-Bold').fontSize(14);
    const nameHeight = doc.heightOfString(name || 'N/A', { width: w - 32 });

    const body = details.length ? details.join('\n') : 'N/A';
    doc.font('Helvetica');
    doc.fontSize(11);
    const bodyHeight = doc.heightOfString(body, {
      width: w - 32,
      lineGap: 3,
    });
    return Math.max(96, 30 + nameHeight + 10 + bodyHeight + 16);
  }

  private drawPartyCard(
    doc: PDFDocumentInstance,
    label: string,
    name: string,
    details: string[],
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    doc.roundedRect(x, y, w, h, 12).fill(this.c.surface);
    doc.roundedRect(x, y, w, h, 12).lineWidth(1).stroke(this.c.border);

    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(this.c.grayLight)
      .text(label, x + 16, y + 14, { characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(14);
    const nameHeight = doc.heightOfString(name || 'N/A', { width: w - 32 });

    doc.fillColor(this.c.dark).text(name || 'N/A', x + 16, y + 30, { width: w - 32 });

    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(this.c.gray)
      .text(details.length ? details.join('\n') : 'N/A', x + 16, y + 30 + nameHeight + 10, {
        width: w - 32,
        lineGap: 3,
      });
  }

  private drawLineItems(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number,
    footerReserve: number
  ): number {
    const colQty = 50;
    const colPrice = 92;
    const colAmount = 96;
    const colDesc = w - colQty - colPrice - colAmount - 36;
    const descX = x;
    const qtyX = descX + colDesc + 12;
    const priceX = qtyX + colQty + 12;
    const amountX = priceX + colPrice + 12;

    const drawHeader = (headerY: number): number => {
      doc
        .moveTo(x, headerY)
        .lineTo(x + w, headerY)
        .lineWidth(1)
        .stroke(this.c.border);
      const labelY = headerY + 12;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(this.c.grayLight);
      doc.text('DESCRIPTION', descX, labelY, { width: colDesc, characterSpacing: 0.5 });
      doc.text('QTY', qtyX, labelY, { width: colQty, align: 'right', characterSpacing: 0.5 });
      doc.text('PRICE', priceX, labelY, { width: colPrice, align: 'right', characterSpacing: 0.5 });
      doc.text('AMOUNT', amountX, labelY, {
        width: colAmount,
        align: 'right',
        characterSpacing: 0.5,
      });
      const afterHeader = headerY + 30;
      doc
        .moveTo(x, afterHeader)
        .lineTo(x + w, afterHeader)
        .lineWidth(1)
        .stroke(this.c.border);
      return afterHeader + 12;
    };

    let currentY = drawHeader(y);
    const rows = data.lineItems.length
      ? data.lineItems
      : [{ description: 'Service Payment', amount: data.total }];

    rows.forEach((item, index) => {
      const normalized = this.normalizeLineItem(item);
      doc.font('Helvetica-Bold').fontSize(13);
      const descHeight = doc.heightOfString(normalized.description, {
        width: colDesc,
      });
      const rowHeight = Math.max(descHeight + 24, 50);

      if (currentY + rowHeight > doc.page.height - footerReserve) {
        currentY = this.addPageAndBackground(doc);
        currentY = drawHeader(currentY);
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(this.c.dark)
        .text(normalized.description, descX, currentY, { width: colDesc });

      const tag = this.getLineItemTag(normalized.description);
      doc.font('Helvetica-Bold').fontSize(9);
      const tagWidth = Math.max(40, doc.widthOfString(tag) + 16);
      doc.roundedRect(descX, currentY + descHeight + 4, tagWidth, 16, 4).fill(this.c.surfaceAlt);
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(this.c.accent)
        .text(tag, descX + 8, currentY + descHeight + 8, { characterSpacing: 0.3 });

      doc
        .font('Helvetica')
        .fontSize(13)
        .fillColor(this.c.dark)
        .text(String(normalized.quantity), qtyX, currentY, { width: colQty, align: 'right' });
      doc.text(this.formatMoney(normalized.unitPrice), priceX, currentY, {
        width: colPrice,
        align: 'right',
      });
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(this.c.dark)
        .text(this.formatMoney(normalized.amount), amountX, currentY, {
          width: colAmount,
          align: 'right',
        });

      currentY += rowHeight;
      if (index < rows.length - 1) {
        doc
          .moveTo(x, currentY - 10)
          .lineTo(x + w, currentY - 10)
          .lineWidth(1)
          .stroke(this.c.border);
      }
    });

    return currentY;
  }

  private drawTotals(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number,
    footerReserve: number
  ): number {
    const rowCount = 2 + (data.tax > 0 ? 1 : 0) + (data.discount > 0 ? 1 : 0);
    const boxH = 24 + rowCount * 22 + 44;
    if (y + boxH > doc.page.height - footerReserve) {
      y = this.addPageAndBackground(doc);
    }

    const boxW = 280;
    const boxX = x + w - boxW;
    doc.roundedRect(boxX, y, boxW, boxH, 12).fill(this.c.surfaceAlt);
    doc.roundedRect(boxX, y, boxW, boxH, 12).lineWidth(1).stroke(this.c.border);

    let py = y + 16;
    py = this.drawTotalRow(doc, 'Subtotal', this.formatMoney(data.subtotal), boxX, py, boxW);
    if (data.tax > 0) {
      py = this.drawTotalRow(
        doc,
        `Tax (${this.getTaxLabel()} GST)`,
        this.formatMoney(data.tax),
        boxX,
        py,
        boxW
      );
    }
    if (data.discount > 0) {
      py = this.drawTotalRow(
        doc,
        'Discount',
        `-${this.formatMoney(data.discount)}`,
        boxX,
        py,
        boxW,
        true
      );
    }

    doc
      .moveTo(boxX + 16, py + 2)
      .lineTo(boxX + boxW - 16, py + 2)
      .lineWidth(1)
      .stroke(this.c.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(this.c.dark)
      .text('Total', boxX + 16, py + 14);
    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor(this.c.accent)
      .text(this.formatMoney(data.total), boxX + 16, py + 8, { width: boxW - 32, align: 'right' });

    return y + boxH;
  }

  private drawPayment(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number,
    footerReserve: number
  ): number {
    const boxH = 78;
    if (y + boxH > doc.page.height - footerReserve) {
      y = this.addPageAndBackground(doc);
    }

    doc.roundedRect(x, y, w, boxH, 12).fill(this.c.surface);
    doc.roundedRect(x, y, w, boxH, 12).lineWidth(1).stroke(this.c.border);

    const items = [
      {
        label: 'PAYMENT METHOD',
        value: data.paymentMethod ? this.formatPaymentMethod(data.paymentMethod) : 'N/A',
      },
      { label: 'REFERENCE', value: data.transactionId ? `#${data.transactionId}` : 'N/A' },
      { label: 'PAID ON', value: data.paidAt ? this.formatDate(data.paidAt) : 'Pending' },
    ];

    items.forEach((item, index) => {
      const colW = w / 3;
      const cx = x + index * colW + 16;
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(this.c.grayLight)
        .text(item.label, cx, y + 14, { characterSpacing: 0.4 });
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(this.c.dark)
        .text(item.value, cx, y + 30, { width: colW - 32 });
    });

    return y + boxH;
  }

  private drawNotesAndTerms(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number,
    footerReserve: number
  ): number {
    const notes = data.notes?.trim();
    const terms = data.termsAndConditions?.trim();
    const hasNotes = Boolean(notes);
    const hasTerms = Boolean(terms);

    if (!hasNotes && !hasTerms) {
      return y;
    }

    doc.font('Helvetica').fontSize(11);
    const noteHeight = hasNotes
      ? doc.heightOfString(notes || '', { width: w - 32, lineGap: 2 }) + 56
      : 0;
    doc.font('Helvetica').fontSize(10);
    const termHeight = hasTerms
      ? doc.heightOfString(terms || '', { width: w - 32, lineGap: 2 }) + 56
      : 0;
    const totalHeight = noteHeight + termHeight + (hasNotes && hasTerms ? 10 : 0);

    if (y + totalHeight > doc.page.height - footerReserve) {
      y = this.addPageAndBackground(doc);
    }

    let currentY = y;
    if (hasNotes) {
      doc.font('Helvetica').fontSize(11);
      currentY = this.drawTextPanel(
        doc,
        'Additional Notes',
        notes || '',
        x,
        currentY,
        w,
        11,
        this.c.surface,
        this.c.grayLight,
        this.c.dark
      );
      currentY += 10;
    }
    if (hasTerms) {
      doc.font('Helvetica').fontSize(10);
      currentY = this.drawTextPanel(
        doc,
        'Payment Terms',
        terms || '',
        x,
        currentY,
        w,
        10,
        this.c.surfaceAlt,
        this.c.grayLight,
        this.c.gray
      );
    }

    return currentY;
  }

  private drawTextPanel(
    doc: PDFDocumentInstance,
    title: string,
    text: string,
    x: number,
    y: number,
    w: number,
    fontSize: number,
    fill: string,
    titleColor: string,
    bodyColor: string
  ): number {
    doc.font('Helvetica').fontSize(fontSize);
    const height = doc.heightOfString(text, { width: w - 32, lineGap: 2 }) + 56;
    doc.roundedRect(x, y, w, height, 12).fill(fill);
    doc.roundedRect(x, y, w, height, 12).lineWidth(1).stroke(this.c.border);
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(titleColor)
      .text(title.toUpperCase(), x + 16, y + 14, { characterSpacing: 0.7 });
    doc
      .font('Helvetica')
      .fontSize(fontSize)
      .fillColor(bodyColor)
      .text(text, x + 16, y + 30, { width: w - 32, lineGap: 2 });
    return y + height;
  }

  private drawFooter(
    doc: PDFDocumentInstance,
    data: InvoicePDFData,
    x: number,
    y: number,
    w: number
  ): void {
    doc.roundedRect(x, y, w, 44, 12).fill('#FAFAFA');
    doc
      .moveTo(x, y)
      .lineTo(x + w, y)
      .lineWidth(1)
      .stroke(this.c.border);

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(this.c.accent)
      .text(data.clinicName, x + 32, y + 16, { width: w - 64 });

    const contactParts = [data.clinicPhone, data.clinicEmail].filter(Boolean) as string[];
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(this.c.gray)
      .text(contactParts.join('   |   '), x + 32, y + 16, { width: w - 64, align: 'right' });
  }

  private drawTotalRow(
    doc: PDFDocumentInstance,
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
    emphasize = false
  ): number {
    doc
      .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(13)
      .fillColor(emphasize ? this.c.accent : this.c.gray)
      .text(label, x + 16, y, { width: w - 32 });
    doc
      .font(emphasize ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(13)
      .fillColor(emphasize ? this.c.accent : this.c.gray)
      .text(value, x + 16, y, { width: w - 32, align: 'right' });
    return y + 22;
  }

  private drawKeyValue(
    doc: PDFDocumentInstance,
    label: string,
    value: string,
    x: number,
    y: number,
    w: number
  ): void {
    doc.font('Helvetica').fontSize(11).fillColor(this.c.gray).text(label, x, y);
    doc
      .font('Helvetica-Bold')
      .fontSize(11.5)
      .fillColor(this.c.dark)
      .text(value, x, y + 16, { width: w });
  }

  private getStatusInfo(status: string) {
    switch (status.toUpperCase()) {
      case 'PAID':
        return { label: 'PAID', bg: this.c.paidBg, text: this.c.paidText, dot: this.c.paidDot };
      case 'PENDING':
        return { label: 'PENDING', bg: this.c.pendBg, text: this.c.pendText, dot: this.c.pendDot };
      case 'OVERDUE':
        return { label: 'OVERDUE', bg: this.c.overBg, text: this.c.overText, dot: this.c.overDot };
      case 'CANCELLED':
        return {
          label: 'CANCELLED',
          bg: this.c.overBg,
          text: this.c.overText,
          dot: this.c.overDot,
        };
      default:
        return { label: 'DRAFT', bg: this.c.draftBg, text: this.c.draftText, dot: this.c.draftDot };
    }
  }

  private getStatusWidth(label: string): number {
    return Math.max(70, label.length * 7 + 28);
  }

  private getLineItemTag(description: string): string {
    const lower = description.toLowerCase();
    if (lower.includes('video')) return 'VIDEO CALL';
    if (lower.includes('clinic') || lower.includes('in-person')) return 'CLINIC';
    if (lower.includes('subscription') || lower.includes('monthly')) return 'MONTHLY';
    if (lower.includes('therapy')) return 'THERAPY';
    return 'SERVICE';
  }

  private normalizeLineItem(item: {
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }): NormalizedLineItem {
    const amount = Number(item.amount || 0);
    const quantity =
      Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
        ? Number(item.quantity)
        : 1;
    const unitPrice =
      Number.isFinite(Number(item.unitPrice)) && Number(item.unitPrice) >= 0
        ? Number(item.unitPrice)
        : quantity > 0
          ? amount / quantity
          : amount;

    return {
      description: this.cleanLineItemDescription(item.description || 'Service'),
      quantity,
      unitPrice,
      amount,
    };
  }

  private cleanLineItemDescription(description: string): string {
    const cleanMap: Record<string, string> = {
      VIDEO_CALL: 'Video Consultation',
      IN_PERSON: 'In-Person Consultation',
      CHAT: 'Chat Consultation',
      SUBSCRIPTION: 'Subscription Payment',
    };
    return cleanMap[String(description || '').toUpperCase()] || description;
  }

  private formatMoney(amount: number | string | undefined | null): string {
    const num = typeof amount === 'string' ? Number.parseFloat(amount) : Number(amount || 0);
    const resolved = Number.isFinite(num) ? num : 0;
    return `Rs. ${resolved.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private formatPaymentMethod(method: string): string {
    const map: Record<string, string> = {
      CASH: 'Cash',
      CARD: 'Credit / Debit Card',
      UPI: 'UPI',
      BANK_TRANSFER: 'Bank Transfer',
      ONLINE: 'Online Payment',
      RAZORPAY: 'Razorpay',
      PHONEPE: 'PhonePe',
      CASHFREE: 'Cashfree',
    };
    return map[String(method || '').toUpperCase()] || method;
  }

  private formatDate(date: Date | string | undefined | null): string {
    if (!date) return 'N/A';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return formatDateInIST(d, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  }

  private getClinicInitials(name: string): string {
    const parts = String(name || '')
      .split(/\s+/)
      .map(part => part.trim().charAt(0))
      .filter(Boolean);
    return (parts.slice(0, 2).join('') || 'IN').toUpperCase();
  }

  private getTaxLabel(): string {
    return 'GST';
  }

  private getPublicInvoiceUrlBase(): string {
    const appConfig = this.configService.getAppConfig();
    return appConfig.apiUrl || appConfig.baseUrl || '';
  }

  getPublicInvoiceUrl(fileName: string): string {
    const baseUrl = this.getPublicInvoiceUrlBase();
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
