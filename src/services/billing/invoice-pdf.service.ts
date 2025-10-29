import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PDFDocument from "pdfkit";
import * as fs from "fs";
import * as path from "path";

export interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  status: string;

  // Clinic details
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  clinicLogo?: string;

  // Patient/User details
  userName: string;
  userEmail?: string;
  userPhone?: string;
  userAddress?: string;

  // Subscription details (if applicable)
  subscriptionPlan?: string;
  subscriptionPeriod?: string;

  // Line items
  lineItems: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }>;

  // Totals
  subtotal: number;
  tax: number;
  discount: number;
  total: number;

  // Payment details
  paidAt?: Date;
  paymentMethod?: string;
  transactionId?: string;

  // Additional notes
  notes?: string;
  termsAndConditions?: string;
}

@Injectable()
export class InvoicePDFService {
  private readonly logger = new Logger(InvoicePDFService.name);
  private readonly invoicesDir: string;

  constructor(private readonly configService: ConfigService) {
    // Create invoices directory if it doesn't exist
    this.invoicesDir = path.join(process.cwd(), "storage", "invoices");
    if (!fs.existsSync(this.invoicesDir)) {
      fs.mkdirSync(this.invoicesDir, { recursive: true });
    }
  }

  /**
   * Generate PDF invoice and save to file system
   * @param data - Invoice data
   * @returns Promise<{ filePath: string, fileName: string }>
   */
  async generateInvoicePDF(
    data: InvoicePDFData,
  ): Promise<{ filePath: string; fileName: string }> {
    try {
      const fileName = `invoice_${data.invoiceNumber}_${Date.now()}.pdf`;
      const filePath = path.join(this.invoicesDir, fileName);

      // Create PDF document
      const doc = new PDFDocument({ size: "A4", margin: 50 });

      // Pipe to file
      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Add content to PDF
      this.addHeader(doc, data);
      this.addClinicDetails(doc, data);
      this.addUserDetails(doc, data);
      this.addInvoiceDetails(doc, data);
      this.addLineItems(doc, data);
      this.addTotals(doc, data);
      this.addPaymentDetails(doc, data);
      this.addFooter(doc, data);

      // Finalize PDF
      doc.end();

      // Wait for file to be written
      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", () => resolve());
        writeStream.on("error", reject);
      });

      this.logger.log(`Invoice PDF generated successfully: ${fileName}`);

      return { filePath, fileName };
    } catch (error) {
      this.logger.error(
        `Failed to generate invoice PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Add header section to PDF
   */
  private addHeader(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    doc.fontSize(26).font("Helvetica-Bold").text("INVOICE", 50, 50);

    // Add status badge
    const statusX = 450;
    const statusY = 50;
    const statusColor = this.getStatusColor(data.status);

    doc
      .rect(statusX, statusY, 100, 30)
      .fillAndStroke(statusColor, "#000000")
      .fontSize(12)
      .fillColor("#FFFFFF")
      .text(data.status.toUpperCase(), statusX + 10, statusY + 8, {
        width: 80,
        align: "center",
      });

    doc.fillColor("#000000"); // Reset color

    doc.moveDown(2);
  }

  /**
   * Add clinic/business details
   */
  private addClinicDetails(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const startY = 110;

    doc.fontSize(14).font("Helvetica-Bold").text(data.clinicName, 50, startY);

    doc.fontSize(10).font("Helvetica");

    let currentY = startY + 20;

    if (data.clinicAddress) {
      doc.text(data.clinicAddress, 50, currentY);
      currentY += 15;
    }

    if (data.clinicPhone) {
      doc.text(`Phone: ${data.clinicPhone}`, 50, currentY);
      currentY += 15;
    }

    if (data.clinicEmail) {
      doc.text(`Email: ${data.clinicEmail}`, 50, currentY);
      currentY += 15;
    }

    doc.moveDown(1);
  }

  /**
   * Add user/patient details
   */
  private addUserDetails(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const startY = 110;
    const startX = 300;

    doc.fontSize(10).font("Helvetica-Bold").text("BILLED TO:", startX, startY);

    doc.fontSize(10).font("Helvetica");

    let currentY = startY + 15;

    doc.text(data.userName, startX, currentY);
    currentY += 15;

    if (data.userEmail) {
      doc.text(data.userEmail, startX, currentY);
      currentY += 15;
    }

    if (data.userPhone) {
      doc.text(data.userPhone, startX, currentY);
      currentY += 15;
    }

    if (data.userAddress) {
      doc.text(data.userAddress, startX, currentY, { width: 250 });
    }

    doc.moveDown(1);
  }

  /**
   * Add invoice details (number, date, etc.)
   */
  private addInvoiceDetails(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const startY = 230;

    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text("Invoice Number:", 50, startY)
      .font("Helvetica")
      .text(data.invoiceNumber, 150, startY);

    doc
      .font("Helvetica-Bold")
      .text("Invoice Date:", 50, startY + 15)
      .font("Helvetica")
      .text(this.formatDate(data.invoiceDate), 150, startY + 15);

    doc
      .font("Helvetica-Bold")
      .text("Due Date:", 50, startY + 30)
      .font("Helvetica")
      .text(this.formatDate(data.dueDate), 150, startY + 30);

    if (data.subscriptionPlan) {
      doc
        .font("Helvetica-Bold")
        .text("Plan:", 300, startY)
        .font("Helvetica")
        .text(data.subscriptionPlan, 400, startY);
    }

    if (data.subscriptionPeriod) {
      doc
        .font("Helvetica-Bold")
        .text("Period:", 300, startY + 15)
        .font("Helvetica")
        .text(data.subscriptionPeriod, 400, startY + 15);
    }

    doc.moveDown(3);
  }

  /**
   * Add line items table
   */
  private addLineItems(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const tableTop = 320;
    const itemCodeX = 50;
    const descriptionX = 150;
    const quantityX = 350;
    const priceX = 420;
    const amountX = 490;

    // Table header
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text("#", itemCodeX, tableTop)
      .text("Description", descriptionX, tableTop)
      .text("Qty", quantityX, tableTop)
      .text("Price", priceX, tableTop)
      .text("Amount", amountX, tableTop);

    // Draw header line
    doc
      .strokeColor("#aaaaaa")
      .lineWidth(1)
      .moveTo(50, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .stroke();

    // Table rows
    let currentY = tableTop + 25;
    doc.font("Helvetica").fontSize(9);

    data.lineItems.forEach((item, index) => {
      doc
        .text((index + 1).toString(), itemCodeX, currentY)
        .text(item.description, descriptionX, currentY, { width: 180 })
        .text(item.quantity?.toString() || "1", quantityX, currentY)
        .text(
          item.unitPrice ? `₹${item.unitPrice.toFixed(2)}` : "-",
          priceX,
          currentY,
        )
        .text(`₹${item.amount.toFixed(2)}`, amountX, currentY);

      currentY += 25;
    });

    // Draw bottom line
    doc
      .strokeColor("#aaaaaa")
      .lineWidth(1)
      .moveTo(50, currentY)
      .lineTo(550, currentY)
      .stroke();

    doc.moveDown(2);
  }

  /**
   * Add totals section
   */
  private addTotals(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const startY = 500;
    const labelX = 380;
    const valueX = 490;

    doc
      .fontSize(10)
      .font("Helvetica")
      .text("Subtotal:", labelX, startY)
      .text(`₹${data.subtotal.toFixed(2)}`, valueX, startY);

    if (data.discount > 0) {
      doc
        .text("Discount:", labelX, startY + 15)
        .text(`-₹${data.discount.toFixed(2)}`, valueX, startY + 15);
    }

    if (data.tax > 0) {
      doc
        .text("Tax:", labelX, startY + 30)
        .text(`₹${data.tax.toFixed(2)}`, valueX, startY + 30);
    }

    // Total with highlight
    const totalY =
      data.discount > 0 || data.tax > 0 ? startY + 50 : startY + 20;

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("TOTAL:", labelX, totalY)
      .text(`₹${data.total.toFixed(2)}`, valueX, totalY);

    doc.moveDown(2);
  }

  /**
   * Add payment details if invoice is paid
   */
  private addPaymentDetails(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    if (data.paidAt) {
      const startY = 580;

      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor("#00AA00")
        .text("PAID", 50, startY, { underline: true });

      doc
        .fillColor("#000000")
        .font("Helvetica")
        .text(`Payment Date: ${this.formatDate(data.paidAt)}`, 50, startY + 15);

      if (data.paymentMethod) {
        doc.text(`Payment Method: ${data.paymentMethod}`, 50, startY + 30);
      }

      if (data.transactionId) {
        doc.text(`Transaction ID: ${data.transactionId}`, 50, startY + 45);
      }
    }

    doc.moveDown(2);
  }

  /**
   * Add footer with notes and terms
   */
  private addFooter(doc: PDFKit.PDFDocument, data: InvoicePDFData) {
    const footerY = 680;

    if (data.notes) {
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("Notes:", 50, footerY)
        .font("Helvetica")
        .text(data.notes, 50, footerY + 12, { width: 500 });
    }

    // Terms and conditions
    const termsY = data.notes ? footerY + 60 : footerY;
    const terms =
      data.termsAndConditions ||
      "Thank you for your business! Payment is due within 30 days. Please include the invoice number with your payment.";

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#666666")
      .text(terms, 50, termsY, { width: 500, align: "center" });

    // Page number
    doc.fontSize(8).text("Page 1 of 1", 50, doc.page.height - 50, {
      align: "center",
      width: 500,
    });
  }

  /**
   * Get status color based on invoice status
   */
  private getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      PAID: "#00AA00",
      PENDING: "#FF9900",
      OVERDUE: "#FF0000",
      DRAFT: "#666666",
      CANCELLED: "#999999",
    };

    return colors[status.toUpperCase()] || "#666666";
  }

  /**
   * Format date to readable string
   */
  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  /**
   * Get public URL for invoice PDF
   */
  getPublicInvoiceUrl(fileName: string): string {
    const baseUrl =
      this.configService.get<string>("API_URL") || "http://localhost:3000";
    return `${baseUrl}/api/billing/invoices/download/${fileName}`;
  }

  /**
   * Delete invoice PDF file
   */
  deleteInvoicePDF(fileName: string): void {
    try {
      const filePath = path.join(this.invoicesDir, fileName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.log(`Invoice PDF deleted: ${fileName}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to delete invoice PDF: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Check if invoice PDF exists
   */
  invoicePDFExists(fileName: string): boolean {
    const filePath = path.join(this.invoicesDir, fileName);
    return fs.existsSync(filePath);
  }

  /**
   * Get invoice file path
   */
  getInvoiceFilePath(fileName: string): string {
    return path.join(this.invoicesDir, fileName);
  }
}
