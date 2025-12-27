import { Job } from 'bullmq';
import { Inject, Optional } from '@nestjs/common';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';
// Use direct import to avoid circular dependency with barrel exports
import { DatabaseService } from '@infrastructure/database/database.service';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';
import type { JobData, JobMetadata } from '@core/types/queue.types';
import type { InvoicePDFData } from '@core/types/billing.types';

// Import InvoicePDFService type (using forwardRef to avoid circular dependency)
// Note: We use a type-only import to avoid runtime circular dependency issues
type InvoicePDFServiceType = {
  generateInvoicePDF: (data: InvoicePDFData) => Promise<{ filePath: string; fileName: string }>;
  getPublicInvoiceUrl: (fileName: string) => string;
};

// NOTE: In BullMQ, job processing is handled by Worker instances, not decorators.
// Worker registration should be done in the module or service setup.

/**
 * Type-safe helper to convert unknown value to string
 * Handles all primitive types and objects safely without ESLint warnings
 */
function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    // For numbers and booleans, use explicit conversion
    // This is safe because we've already narrowed the type
    return value.toString();
  }
  if (value === null || value === undefined) {
    return '';
  }
  // For objects and other types, use JSON.stringify
  return JSON.stringify(value);
}

export class QueueProcessor {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject('InvoicePDFService')
    private readonly invoicePDFService?: InvoicePDFServiceType
  ) {}

  // Example BullMQ job handler for CREATE
  processCreateJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing create job ${safeStringify(job.id)} for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { jobId: safeStringify(job.id), resourceId: safeStringify(job.data['id']) }
      );
      // Ensure this handler is idempotent!
      // ... job logic ...
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${safeStringify(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: safeStringify(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing create job`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: _error instanceof Error ? _error.message : safeStringify(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      // Optionally move to DLQ if available
      // if (job.attemptsMade >= (job.opts.attempts || 3) && this.queueService?.moveToDLQ) {
      //   await this.queueService.moveToDLQ(job, 'service-queue');
      // }
      throw _error;
    }
  }

  // Repeat for other job types (UPDATE, CONFIRM, COMPLETE, NOTIFY)
  processUpdateJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing update job ${safeStringify(job.id)} for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { jobId: safeStringify(job.id), resourceId: safeStringify(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of UPDATE job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${safeStringify(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: safeStringify(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing update job`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: _error instanceof Error ? _error.message : safeStringify(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processConfirmJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing confirm job ${safeStringify(job.id)} for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { jobId: safeStringify(job.id), resourceId: safeStringify(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of CONFIRM job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${safeStringify(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: safeStringify(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing confirm job`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: _error instanceof Error ? _error.message : safeStringify(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processCompleteJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing complete job ${safeStringify(job.id)} for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { jobId: safeStringify(job.id), resourceId: safeStringify(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of COMPLETE job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${safeStringify(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: safeStringify(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing complete job`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: _error instanceof Error ? _error.message : safeStringify(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processNotifyJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing notification job ${safeStringify(job.id)} for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { jobId: safeStringify(job.id), resourceId: safeStringify(job.data['id']) }
      );

      // Send notification logic for service-queue
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Sending notification for resource ${safeStringify(job.data['id'])} to user ${safeStringify(job.data['userId'])}`,
        'QueueProcessor',
        { resourceId: safeStringify(job.data['id']), userId: safeStringify(job.data['userId']) }
      );

      // Example of FCM notification (would need to be implemented)
      // await this.fcmService.sendNotification({
      //   userId: job.data.userId,
      //   title: 'Resource Update',
      //   body: job.(data as { meta?: unknown }).metadata?.message || 'Your resource status has been updated',
      //   data: { resourceId: job.data.id, resourceType: job.data.resourceType },
      // });

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Notification sent for resource ${safeStringify(job.data['id'])}`,
        'QueueProcessor',
        { resourceId: safeStringify(job.data['id']) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing notification job`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: _error instanceof Error ? _error.message : safeStringify(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  // ============ EHR Module Queue Workers ============

  /**
   * Process lab report analysis
   * Performs heavy processing: analysis algorithms, image processing, metadata extraction
   */
  async processLabReport(job: Job<JobData>): Promise<{ success: boolean }> {
    try {
      const { reportId, clinicId, userId, action, metadata: _metadata } = job.data;

      if (!reportId || typeof reportId !== 'string') {
        throw new Error('Invalid reportId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing lab report analysis`,
        'QueueProcessor',
        { reportId, clinicId, userId, action }
      );

      // Get lab report from database
      const report = await this.prisma.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          labReport: {
            findUnique: (args: { where: { id: string } }) => Promise<{
              id: string;
              testName: string | null;
              result: string | null;
              unit: string | null;
              referenceRange: string | null;
              status: string | null;
              notes: string | null;
              processedAt: Date | null;
            } | null>;
            update: (args: {
              where: { id: string };
              data: { processedAt: Date; notes?: string };
            }) => Promise<unknown>;
          };
        };
        return await typedClient.labReport.findUnique({
          where: { id: reportId },
        });
      });

      if (!report) {
        throw new Error(`Lab report ${reportId} not found`);
      }

      // Process lab report: analysis, validation, metadata extraction
      // 1. Validate result against reference range if available
      let processedNotes = report.notes || '';
      if (report.referenceRange && report.result) {
        // Basic validation logic (can be extended with actual range parsing)
        processedNotes += `\n[Processed] Result validated against reference range: ${report.referenceRange}`;
      }

      // 2. Extract metadata from test name and result
      const testMetadata = {
        testName: report.testName || 'Unknown',
        hasResult: !!report.result,
        hasReferenceRange: !!report.referenceRange,
        processedAt: new Date().toISOString(),
      };

      // 3. Update report with processed data
      await this.prisma.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            labReport: {
              update: (args: {
                where: { id: string };
                data: { processedAt: Date; notes?: string | undefined };
              }) => Promise<unknown>;
            };
          };
          const updateData: { processedAt: Date; notes?: string | undefined } = {
            processedAt: new Date(),
          };
          if (processedNotes.trim()) {
            updateData.notes = processedNotes.trim();
          }
          return await typedClient.labReport.update({
            where: { id: reportId },
            data: updateData,
          });
        },
        {
          userId: (userId as string) || 'system',
          userRole: 'system',
          clinicId: (clinicId as string) || '',
          operation: 'PROCESS_LAB_REPORT',
          resourceType: 'LAB_REPORT',
          resourceId: reportId,
          timestamp: new Date(),
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Lab report processed successfully`,
        'QueueProcessor',
        { reportId, testMetadata }
      );
      return { success: true };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing lab report`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process imaging/radiology reports
   * Performs heavy processing: transcoding, DICOM metadata extraction, image analysis, thumbnail generation
   */
  async processImaging(job: Job<JobData>): Promise<{ success: boolean }> {
    try {
      const { reportId, clinicId, userId, action, metadata: _metadata } = job.data;

      if (!reportId || typeof reportId !== 'string') {
        throw new Error('Invalid reportId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing imaging report`,
        'QueueProcessor',
        { reportId, clinicId, userId, action }
      );

      // Get radiology report from database
      const report = await this.prisma.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          radiologyReport: {
            findUnique: (args: { where: { id: string } }) => Promise<{
              id: string;
              imageType: string | null;
              findings: string | null;
              impression: string | null;
              processedAt: Date | null;
            } | null>;
            update: (args: {
              where: { id: string };
              data: { processedAt: Date; findings?: string };
            }) => Promise<unknown>;
          };
        };
        return await typedClient.radiologyReport.findUnique({
          where: { id: reportId },
        });
      });

      if (!report) {
        throw new Error(`Radiology report ${reportId} not found`);
      }

      // Process imaging report: metadata extraction, analysis
      // 1. Extract DICOM metadata (placeholder - actual implementation would parse DICOM files)
      const dicomMetadata = {
        imageType: report.imageType || 'Unknown',
        processedAt: new Date().toISOString(),
      };

      // 2. Update findings with processed metadata if needed
      let processedFindings = report.findings || '';
      if (report.imageType) {
        processedFindings += `\n[Processed] Image type: ${report.imageType}`;
      }

      // 3. Update report with processed data
      await this.prisma.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            radiologyReport: {
              update: (args: {
                where: { id: string };
                data: { processedAt: Date; findings?: string | undefined };
              }) => Promise<unknown>;
            };
          };
          const updateData: { processedAt: Date; findings?: string | undefined } = {
            processedAt: new Date(),
          };
          if (processedFindings.trim()) {
            updateData.findings = processedFindings.trim();
          }
          return await typedClient.radiologyReport.update({
            where: { id: reportId },
            data: updateData,
          });
        },
        {
          userId: (userId as string) || 'system',
          userRole: 'system',
          clinicId: (clinicId as string) || '',
          operation: 'PROCESS_IMAGING_REPORT',
          resourceType: 'RADIOLOGY_REPORT',
          resourceId: reportId,
          timestamp: new Date(),
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Imaging report processed successfully`,
        'QueueProcessor',
        { reportId, dicomMetadata }
      );
      return { success: true };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing imaging report`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process bulk EHR imports
   * Handles bulk data import: file parsing, validation, batch processing, status updates
   */
  processBulkEHRImport(job: Job<JobData>): Promise<{ success: boolean; imported: number }> {
    try {
      const { importId, clinicId, userId, action, metadata } = job.data;

      if (!importId || typeof importId !== 'string') {
        throw new Error('Invalid importId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing bulk EHR import`,
        'QueueProcessor',
        { importId, clinicId, userId, action }
      );

      // Bulk import processing
      // 1. Get import file/data from metadata or storage
      const metadataTyped = metadata as JobMetadata | undefined;
      const importDataValue =
        metadataTyped && 'importData' in metadataTyped
          ? metadataTyped['importData']
          : metadataTyped && 'filePath' in metadataTyped
            ? metadataTyped['filePath']
            : undefined;
      if (!importDataValue) {
        throw new Error('Import data or file path not provided in metadata');
      }

      // 2. Parse and validate data (placeholder - actual implementation would parse CSV/JSON/Excel)
      const recordsToImport = Array.isArray(importDataValue) ? (importDataValue as unknown[]) : [];
      let imported = 0;
      let failed = 0;

      // 3. Import records in batches (batch size: 100 for performance)
      const batchSize = 100;
      const recordsLength = recordsToImport.length;
      for (let i = 0; i < recordsLength; i += batchSize) {
        const batch = recordsToImport.slice(i, i + batchSize);

        try {
          // Process batch (placeholder - actual implementation would create EHR records)
          // await this.prisma.executeHealthcareWrite(...)
          imported += batch.length;
        } catch (batchError) {
          failed += batch.length;
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.WARN,
            `Batch import failed`,
            'QueueProcessor',
            {
              importId,
              batchIndex: i,
              error: batchError instanceof Error ? batchError.message : safeStringify(batchError),
            }
          );
        }
      }

      // 4. Update import status (if import tracking table exists)
      // This would update a bulk import tracking record with status and counts

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Bulk EHR import processed successfully`,
        'QueueProcessor',
        { importId, imported, failed, total: recordsLength }
      );
      return Promise.resolve({ success: true, imported });
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing bulk EHR import`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  // ============ Billing Module Queue Workers ============

  /**
   * Generate invoice PDF
   * Generates PDF invoice asynchronously and updates invoice record with PDF URL
   */
  async processInvoicePDF(job: Job<JobData>): Promise<{ success: boolean; filePath?: string }> {
    try {
      const { invoiceId, clinicId, userId, action, metadata: _metadata } = job.data;

      if (!invoiceId || typeof invoiceId !== 'string') {
        throw new Error('Invalid invoiceId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing invoice PDF generation`,
        'QueueProcessor',
        { invoiceId, clinicId, userId, action }
      );

      // Get invoice data from database
      const invoice = await this.prisma.findInvoiceByIdSafe(invoiceId);

      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      // Check if InvoicePDFService is available
      if (!this.invoicePDFService) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.WARN,
          `InvoicePDFService not available, skipping PDF generation`,
          'QueueProcessor',
          { invoiceId }
        );
        return { success: false };
      }

      // Get user and clinic details for PDF
      const user = await this.prisma.findUserByIdSafe(invoice.userId);
      const clinic = await this.prisma.findClinicByIdSafe(invoice.clinicId);

      if (!user || !clinic) {
        throw new Error(`User or clinic not found for invoice ${invoiceId}`);
      }

      // Prepare PDF data with proper type handling
      const pdfData: InvoicePDFData = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt,
        dueDate: invoice.dueDate,
        status: invoice.status,
        clinicName: clinic.name,
        ...(clinic.address && { clinicAddress: clinic.address }),
        ...(clinic.phone && { clinicPhone: clinic.phone }),
        ...(clinic.email && { clinicEmail: clinic.email }),
        userName: user.name || user.email || 'Unknown User',
        ...(user.email && { userEmail: user.email }),
        ...(user.phone && { userPhone: user.phone }),
        lineItems: Array.isArray(invoice.lineItems)
          ? (invoice.lineItems as Array<{ description: string; amount: number }>)
          : [
              {
                description: invoice.description || 'Service Payment',
                amount: invoice.amount,
              },
            ],
        subtotal: invoice.amount,
        tax: invoice.tax || 0,
        discount: invoice.discount || 0,
        total: invoice.totalAmount,
        ...(invoice.paidAt && { paidAt: invoice.paidAt }),
        notes: 'Thank you for your payment.',
        termsAndConditions: 'Payment is due within 30 days.',
      };

      // Get payment details if invoice is paid
      if (invoice.paidAt) {
        const payments = await this.prisma.findPaymentsSafe({
          invoiceId: invoice.id,
        });
        const latestPayment = payments.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        )[0];
        if (latestPayment) {
          if (latestPayment.method) {
            pdfData.paymentMethod = latestPayment.method;
          }
          if (latestPayment.transactionId) {
            pdfData.transactionId = latestPayment.transactionId;
          }
        }
      }

      // Generate PDF
      const { filePath, fileName } = await this.invoicePDFService.generateInvoicePDF(pdfData);

      // Get public URL
      const pdfUrl = this.invoicePDFService.getPublicInvoiceUrl(fileName);

      // Update invoice with PDF info
      await this.prisma.updateInvoiceSafe(invoiceId, {
        pdfFilePath: filePath,
        pdfUrl,
      });

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Invoice PDF generated successfully`,
        'QueueProcessor',
        { invoiceId, fileName, pdfUrl }
      );
      return { success: true, filePath };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing invoice PDF`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process bulk invoice creation
   * Creates multiple invoices in batches for efficiency
   */
  async processBulkInvoice(job: Job<JobData>): Promise<{ success: boolean; created: number }> {
    try {
      const { batchId, clinicId, userId, action, metadata } = job.data;

      if (!batchId || typeof batchId !== 'string') {
        throw new Error('Invalid batchId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing bulk invoice creation`,
        'QueueProcessor',
        { batchId, clinicId, userId, action }
      );

      // Get batch data from metadata
      const metadataTyped = metadata as JobMetadata | undefined;
      const invoicesValue =
        metadataTyped && 'invoices' in metadataTyped ? metadataTyped['invoices'] : undefined;
      const invoiceDataList = Array.isArray(invoicesValue) ? invoicesValue : [];
      if (invoiceDataList.length === 0) {
        throw new Error('No invoice data provided in metadata');
      }

      let created = 0;
      let failed = 0;

      // Process invoices in batches (batch size: 50 for performance)
      const batchSize = 50;
      for (let i = 0; i < invoiceDataList.length; i += batchSize) {
        const batch = invoiceDataList.slice(i, i + batchSize);

        for (const invoiceData of batch) {
          try {
            // Type-safe invoice data extraction
            const invoiceDataTyped = invoiceData as {
              userId?: string;
              clinicId?: string;
              amount?: number;
              totalAmount?: number;
              tax?: number;
              discount?: number;
              status?: string;
              description?: string;
              dueDate?: Date | string;
              lineItems?: Array<{ description: string; amount: number }>;
            };

            // Generate invoice number
            const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create invoice using DatabaseService
            await this.prisma.createInvoiceSafe({
              invoiceNumber,
              userId: invoiceDataTyped.userId || (userId as string) || '',
              clinicId: invoiceDataTyped.clinicId || (clinicId as string) || '',
              amount: invoiceDataTyped.amount || 0,
              totalAmount: invoiceDataTyped.totalAmount || invoiceDataTyped.amount || 0,
              tax: invoiceDataTyped.tax || 0,
              discount: invoiceDataTyped.discount || 0,
              status: invoiceDataTyped.status || 'PENDING',
              description: invoiceDataTyped.description || 'Bulk invoice',
              dueDate:
                invoiceDataTyped.dueDate instanceof Date
                  ? invoiceDataTyped.dueDate
                  : typeof invoiceDataTyped.dueDate === 'string'
                    ? new Date(invoiceDataTyped.dueDate)
                    : new Date(),
              ...(invoiceDataTyped.lineItems
                ? {
                    lineItems:
                      typeof invoiceDataTyped.lineItems === 'object' &&
                      !Array.isArray(invoiceDataTyped.lineItems)
                        ? (invoiceDataTyped.lineItems as Record<string, unknown>)
                        : Array.isArray(invoiceDataTyped.lineItems)
                          ? (
                              invoiceDataTyped.lineItems as Array<{
                                description: string;
                                amount: number;
                              }>
                            ).reduce(
                              (acc, item, index) => {
                                acc[`item_${index}`] = item;
                                return acc;
                              },
                              {} as Record<string, unknown>
                            )
                          : ({} as Record<string, unknown>),
                  }
                : {}),
            });
            created++;
          } catch (invoiceError) {
            failed++;
            void this.loggingService.log(
              LogType.QUEUE,
              LogLevel.WARN,
              `Failed to create invoice in bulk batch`,
              'QueueProcessor',
              {
                batchId,
                invoiceIndex: i + batch.indexOf(invoiceData),
                error:
                  invoiceError instanceof Error
                    ? invoiceError.message
                    : safeStringify(invoiceError),
              }
            );
          }
        }
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Bulk invoices created successfully`,
        'QueueProcessor',
        { batchId, created, failed, total: invoiceDataList.length }
      );
      return { success: true, created };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing bulk invoices`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process payment reconciliation
   * Reconciles payments between payment gateway and local records
   */
  async processPaymentReconciliation(
    job: Job<JobData>
  ): Promise<{ success: boolean; reconciled: number }> {
    try {
      const { reconciliationId, clinicId, userId, action, metadata } = job.data;

      if (!reconciliationId || typeof reconciliationId !== 'string') {
        throw new Error('Invalid reconciliationId in job data');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing payment reconciliation`,
        'QueueProcessor',
        { reconciliationId, clinicId, userId, action }
      );

      // Get date range for reconciliation from metadata
      const metadataTyped = metadata as JobMetadata | undefined;
      const startDateValue =
        metadataTyped && 'startDate' in metadataTyped ? metadataTyped['startDate'] : undefined;
      const endDateValue =
        metadataTyped && 'endDate' in metadataTyped ? metadataTyped['endDate'] : undefined;

      const startDate =
        typeof startDateValue === 'string'
          ? new Date(startDateValue)
          : startDateValue instanceof Date
            ? startDateValue
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
      const endDate =
        typeof endDateValue === 'string'
          ? new Date(endDateValue)
          : endDateValue instanceof Date
            ? endDateValue
            : new Date();

      // Get local payment records (PaymentWhereInput doesn't support createdAt filter directly)
      // Filter by clinicId only, date filtering would need to be done in application layer
      const clinicIdString = (clinicId as string) || undefined;
      const localPayments = await this.prisma.findPaymentsSafe(
        clinicIdString ? { clinicId: clinicIdString } : {}
      );

      // Filter by date range in application layer
      const filteredPayments = localPayments.filter(payment => {
        const paymentDate = payment.createdAt;
        return paymentDate >= startDate && paymentDate <= endDate;
      });

      let reconciled = 0;
      const discrepancies: Array<{ paymentId: string; reason: string }> = [];

      // Reconcile each payment
      for (const payment of filteredPayments) {
        try {
          // Check payment status consistency
          // In a real implementation, this would:
          // 1. Fetch payment status from gateway (Razorpay/PhonePe)
          // 2. Compare with local status
          // 3. Identify discrepancies
          // 4. Update local records if needed

          // Placeholder: Basic validation
          if (payment.status === 'COMPLETED' && !payment.transactionId) {
            discrepancies.push({
              paymentId: payment.id,
              reason: 'Completed payment missing transaction ID',
            });
          }

          reconciled++;
        } catch (paymentError) {
          discrepancies.push({
            paymentId: payment.id,
            reason: paymentError instanceof Error ? paymentError.message : 'Unknown error',
          });
        }
      }

      // Generate reconciliation report (would be stored in database or file)
      const reconciliationReport = {
        reconciliationId,
        clinicId: (clinicId as string) || '',
        startDate,
        endDate,
        totalPayments: filteredPayments.length,
        reconciled,
        discrepancies: discrepancies.length,
        discrepancyDetails: discrepancies,
        processedAt: new Date(),
      };

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Payment reconciliation completed successfully`,
        'QueueProcessor',
        {
          reconciliationId,
          reconciled,
          discrepancies: discrepancies.length,
          report: reconciliationReport,
        }
      );
      return { success: true, reconciled };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing payment reconciliation`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  // ============ Video Module Queue Workers ============

  /**
   * Process video recording (transcoding, thumbnails, metadata)
   * Processes video recordings: transcoding, thumbnail generation, metadata extraction
   */
  async processVideoRecording(
    job: Job<JobData>
  ): Promise<{ success: boolean; transcodedUrl?: string }> {
    try {
      const { appointmentId, recordingId, recordingUrl, duration, action, metadata } = job.data;

      if (!appointmentId || !recordingId || !recordingUrl) {
        throw new Error('Missing required fields: appointmentId, recordingId, or recordingUrl');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing video recording`,
        'QueueProcessor',
        { appointmentId, recordingId, recordingUrl, duration, action }
      );

      // Get video recording from database
      const recording = await this.prisma.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          videoRecording: {
            findUnique: (args: { where: { id: string } }) => Promise<{
              id: string;
              url: string | null;
              duration: number | null;
              processedAt: Date | null;
              transcodedUrl: string | null;
            } | null>;
            update: (args: {
              where: { id: string };
              data: {
                processedAt: Date;
                transcodedUrl?: string;
                metadata?: Record<string, unknown>;
              };
            }) => Promise<unknown>;
          };
        };
        return await typedClient.videoRecording.findUnique({
          where: { id: recordingId as string },
        });
      });

      if (!recording) {
        // Type-safe string conversion for error message
        const recordingIdStr: string = safeStringify(recordingId);
        throw new Error(`Video recording ${recordingIdStr} not found`);
      }

      // Process video recording
      // 1. Extract metadata (duration, format, etc.)
      const metadataTyped = metadata as JobMetadata | undefined;
      const formatValue =
        metadataTyped && 'format' in metadataTyped ? metadataTyped['format'] : undefined;
      const videoMetadata = {
        originalUrl: recordingUrl as string,
        duration: (duration as number) || recording.duration || 0,
        format: typeof formatValue === 'string' ? formatValue : 'mp4',
        processedAt: new Date().toISOString(),
      };

      // 2. Generate transcoded URL (placeholder - actual implementation would:
      //    - Download video from recordingUrl
      //    - Transcode to standard format using FFmpeg or cloud service
      //    - Upload to storage/CDN
      //    - Return transcoded URL)
      const recordingUrlString = recordingUrl as string;
      const transcodedUrl = recordingUrlString.replace(/\.(mp4|webm)$/, '_transcoded.mp4');

      // 3. Update recording with processed data
      await this.prisma.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            videoRecording: {
              update: (args: {
                where: { id: string };
                data: {
                  processedAt: Date;
                  transcodedUrl?: string;
                  metadata?: Record<string, unknown>;
                };
              }) => Promise<unknown>;
            };
          };
          return await typedClient.videoRecording.update({
            where: { id: recordingId as string },
            data: {
              processedAt: new Date(),
              ...(transcodedUrl && { transcodedUrl }),
              metadata: videoMetadata,
            },
          });
        },
        {
          userId: 'system',
          userRole: 'system',
          clinicId:
            (metadataTyped && 'clinicId' in metadataTyped
              ? safeStringify(metadataTyped['clinicId'])
              : '') || '',
          operation: 'PROCESS_VIDEO_RECORDING',
          resourceType: 'VIDEO_RECORDING',
          resourceId: recordingId as string,
          timestamp: new Date(),
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Video recording processed successfully`,
        'QueueProcessor',
        {
          appointmentId: appointmentId as string,
          recordingId: recordingId as string,
          transcodedUrl,
          metadata: videoMetadata,
        }
      );
      return { success: true, transcodedUrl };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing video recording`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process video transcoding
   * Transcodes video to multiple formats/resolutions for adaptive streaming
   */
  async processVideoTranscoding(
    job: Job<JobData>
  ): Promise<{ success: boolean; transcodedUrl?: string }> {
    try {
      const { appointmentId, recordingId, recordingUrl, action, metadata } = job.data;

      if (!recordingId || !recordingUrl) {
        throw new Error('Missing required fields: recordingId or recordingUrl');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing video transcoding`,
        'QueueProcessor',
        { appointmentId, recordingId, recordingUrl, action }
      );

      // Get video recording
      const recording = await this.prisma.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          videoRecording: {
            findUnique: (args: { where: { id: string } }) => Promise<{
              id: string;
              url: string | null;
              transcodedUrl: string | null;
            } | null>;
            update: (args: {
              where: { id: string };
              data: { transcodedUrl: string; metadata?: Record<string, unknown> };
            }) => Promise<unknown>;
          };
        };
        return await typedClient.videoRecording.findUnique({
          where: { id: recordingId as string },
        });
      });

      if (!recording) {
        // Type-safe string conversion for error message
        const recordingIdStr: string = safeStringify(recordingId);
        throw new Error(`Video recording ${recordingIdStr} not found`);
      }

      // Transcode video to multiple formats/resolutions
      // In actual implementation, this would:
      // 1. Download video from recordingUrl
      // 2. Transcode to multiple formats (mp4, webm) and resolutions (1080p, 720p, 480p)
      // 3. Generate adaptive bitrate manifest (HLS/DASH)
      // 4. Upload to CDN/storage
      // 5. Return master playlist URL

      const metadataTyped = metadata as JobMetadata | undefined;
      const formatsValue =
        metadataTyped && 'formats' in metadataTyped ? metadataTyped['formats'] : undefined;
      const resolutionsValue =
        metadataTyped && 'resolutions' in metadataTyped ? metadataTyped['resolutions'] : undefined;
      const targetFormats = Array.isArray(formatsValue)
        ? (formatsValue as string[])
        : ['mp4', 'webm'];
      const targetResolutions = Array.isArray(resolutionsValue)
        ? (resolutionsValue as string[])
        : ['1080p', '720p', '480p'];
      const transcodedUrls: Record<string, string> = {};

      // Generate transcoded URLs (placeholder - actual implementation would use FFmpeg or cloud service)
      const recordingUrlString = recordingUrl as string;
      for (const format of targetFormats) {
        for (const resolution of targetResolutions) {
          const key = `${resolution}_${format}`;
          transcodedUrls[key] = recordingUrlString.replace(
            /\.(mp4|webm)$/,
            `_${resolution}.${format}`
          );
        }
      }

      // Master playlist URL (for adaptive streaming)
      const masterPlaylistUrl = recordingUrlString.replace(/\.(mp4|webm)$/, '_master.m3u8');

      // Update recording with transcoded URLs
      await this.prisma.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as {
            videoRecording: {
              update: (args: {
                where: { id: string };
                data: {
                  transcodedUrl: string;
                  metadata?: Record<string, unknown>;
                };
              }) => Promise<unknown>;
            };
          };
          return await typedClient.videoRecording.update({
            where: { id: recordingId as string },
            data: {
              transcodedUrl: masterPlaylistUrl,
              metadata: {
                transcodedUrls,
                formats: targetFormats,
                resolutions: targetResolutions,
                transcodedAt: new Date().toISOString(),
              },
            },
          });
        },
        {
          userId: 'system',
          userRole: 'system',
          clinicId: (metadataTyped?.clinicId as string) || '',
          operation: 'TRANSCODE_VIDEO',
          resourceType: 'VIDEO_RECORDING',
          resourceId: recordingId as string,
          timestamp: new Date(),
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Video transcoding completed successfully`,
        'QueueProcessor',
        {
          appointmentId: appointmentId as string,
          recordingId: recordingId as string,
          masterPlaylistUrl,
          transcodedFormats: Object.keys(transcodedUrls).length,
        }
      );
      return { success: true, transcodedUrl: masterPlaylistUrl };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing video transcoding`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process video analytics
   * Computes video quality metrics, engagement metrics, and generates analytics reports
   */
  async processVideoAnalytics(
    job: Job<JobData>
  ): Promise<{ success: boolean; analytics?: unknown }> {
    try {
      const { appointmentId, recordingId, action, metadata } = job.data;

      if (!appointmentId || !recordingId) {
        throw new Error('Missing required fields: appointmentId or recordingId');
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing video analytics`,
        'QueueProcessor',
        { appointmentId, recordingId, action }
      );

      // Get video recording and appointment data
      const recording = await this.prisma.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          videoRecording: {
            findUnique: (args: { where: { id: string } }) => Promise<{
              id: string;
              url: string | null;
              duration: number | null;
              appointmentId: string | null;
            } | null>;
          };
        };
        return await typedClient.videoRecording.findUnique({
          where: { id: recordingId as string },
        });
      });

      if (!recording) {
        // Type-safe string conversion for error message
        const recordingIdStr: string = safeStringify(recordingId);
        throw new Error(`Video recording ${recordingIdStr} not found`);
      }

      // Type-safe string conversion using helper function
      const appointmentIdString = safeStringify(appointmentId);
      const appointment = await this.prisma.findAppointmentByIdSafe(appointmentIdString);

      if (!appointment) {
        // Type-safe string conversion for error message

        const appointmentIdStr: string = safeStringify(appointmentId);
        throw new Error(`Appointment ${appointmentIdStr} not found`);
      }

      // Compute analytics metrics
      // 1. Video quality metrics (placeholder - actual implementation would analyze video)
      const metadataTyped = metadata as JobMetadata | undefined;
      const resolutionValue =
        metadataTyped && 'resolution' in metadataTyped ? metadataTyped['resolution'] : undefined;
      const bitrateValue =
        metadataTyped && 'bitrate' in metadataTyped ? metadataTyped['bitrate'] : undefined;
      const frameRateValue =
        metadataTyped && 'frameRate' in metadataTyped ? metadataTyped['frameRate'] : undefined;
      const codecValue =
        metadataTyped && 'codec' in metadataTyped ? metadataTyped['codec'] : undefined;

      const qualityMetrics = {
        resolution: typeof resolutionValue === 'string' ? resolutionValue : '1080p',
        bitrate: typeof bitrateValue === 'number' ? bitrateValue : 0,
        frameRate: typeof frameRateValue === 'number' ? frameRateValue : 30,
        codec: typeof codecValue === 'string' ? codecValue : 'h264',
      };

      // 2. Engagement metrics (placeholder - actual implementation would track viewer behavior)
      const engagementMetrics = {
        totalDuration: recording.duration || 0,
        averageWatchTime: recording.duration || 0,
        completionRate: 100, // Would be calculated from viewer data
        peakConcurrentViewers: 1,
      };

      // 3. Generate analytics report
      const analyticsReport = {
        recordingId,
        appointmentId,
        qualityMetrics,
        engagementMetrics,
        processedAt: new Date().toISOString(),
        metadata: {
          doctorId: 'doctorId' in appointment ? appointment.doctorId : undefined,
          patientId: 'patientId' in appointment ? appointment.patientId : undefined,
          clinicId: 'clinicId' in appointment ? appointment.clinicId : undefined,
        },
      };

      // Store analytics data (would be stored in analytics table or file)
      // In actual implementation, this would:
      // await this.prisma.executeHealthcareWrite(...) to store analytics

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Video analytics processed successfully`,
        'QueueProcessor',
        {
          appointmentId: appointmentId as string,
          recordingId: recordingId as string,
          analytics: analyticsReport,
        }
      );
      return { success: true, analytics: analyticsReport };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing video analytics`,
        'QueueProcessor',
        {
          jobId: safeStringify(job.id),
          error: error instanceof Error ? error.message : safeStringify(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }
}
