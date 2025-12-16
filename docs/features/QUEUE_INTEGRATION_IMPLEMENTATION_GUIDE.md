# Queue Integration Implementation Guide

**Date**: 2024  
**Status**: 📋 **IMPLEMENTATION GUIDE**

---

## 📋 Overview

This guide provides patterns and examples for integrating queue processing into EHR, Billing, and Video modules.

---

## ✅ Module Setup (Completed)

All modules now have `QueueModule` imported:
- ✅ `EHRModule` - QueueModule added
- ✅ `BillingModule` - QueueModule added  
- ✅ `VideoModule` - QueueModule added

---

## 🔧 Implementation Patterns

### Pattern 1: EHR Lab Report Processing

**Location**: `src/services/ehr/ehr.service.ts`

**Example Implementation**:
```typescript
import { QueueService } from '@queue/src/queue.service';

constructor(
  // ... existing dependencies
  private readonly queueService: QueueService
) {}

async createLabReport(data: CreateLabReportDto) {
  // Create report synchronously
  const report = await this.databaseService.create(...);
  
  // Queue heavy processing asynchronously
  await this.queueService.addJob('lab', {
    reportId: report.id,
    clinicId: report.clinicId,
    userId: report.userId,
    action: 'process_analysis',
    metadata: {
      testName: data.testName,
      result: data.result,
    }
  }, {
    priority: 'high',
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    }
  });
  
  return report;
}
```

**Queue Worker** (to be created in `src/libs/infrastructure/queue/src/queue.processor.ts`):
```typescript
async processLabReport(job: Job<JobData>) {
  const { reportId, clinicId, userId, action } = job.data;
  
  // Heavy processing (analysis, image processing, etc.)
  // This runs asynchronously without blocking the API response
  
  await this.loggingService.log(
    LogType.SYSTEM,
    LogLevel.INFO,
    'Lab report processed',
    'QueueProcessor',
    { reportId }
  );
}
```

---

### Pattern 2: Billing Invoice PDF Generation

**Location**: `src/services/billing/billing.service.ts`

**Example Implementation**:
```typescript
async createInvoice(data: CreateInvoiceDto) {
  // Create invoice record
  const invoice = await this.databaseService.create(...);
  
  // Queue PDF generation (heavy operation)
  await this.queueService.addJob('billing', {
    invoiceId: invoice.id,
    clinicId: invoice.clinicId,
    action: 'generate_pdf',
    metadata: {
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
    }
  }, {
    priority: 'normal',
    attempts: 3,
  });
  
  return invoice;
}
```

**Queue Worker**:
```typescript
async processInvoicePDF(job: Job<JobData>) {
  const { invoiceId } = job.data;
  
  // Generate PDF asynchronously
  const pdfBuffer = await this.invoicePDFService.generatePDF(invoiceId);
  
  // Store PDF or send via email/WhatsApp
  // This doesn't block the API response
}
```

---

### Pattern 3: Video Recording Processing

**Location**: `src/services/video/video.service.ts`

**Example Implementation**:
```typescript
async stopRecording(appointmentId: string) {
  // Stop recording synchronously
  await this.videoProvider.stopRecording(appointmentId);
  
  // Queue processing/transcoding
  await this.queueService.addJob('video', {
    appointmentId,
    action: 'process_recording',
    metadata: {
      recordingId: recording.id,
      format: 'mp4',
    }
  }, {
    priority: 'normal',
    attempts: 2,
  });
  
  return { success: true };
}
```

**Queue Worker**:
```typescript
async processVideoRecording(job: Job<JobData>) {
  const { appointmentId, recordingId } = job.data;
  
  // Transcode video, generate thumbnails, extract metadata
  // This runs asynchronously without blocking
}
```

---

## 📊 Queue Constants

Add new queue names to `src/libs/infrastructure/queue/src/queue.constants.ts`:

```typescript
export const LAB_REPORT_QUEUE = 'lab-report-queue';
export const IMAGING_QUEUE = 'imaging-queue';
export const BULK_EHR_IMPORT_QUEUE = 'bulk-ehr-import-queue';
export const INVOICE_PDF_QUEUE = 'invoice-pdf-queue';
export const BULK_INVOICE_QUEUE = 'bulk-invoice-queue';
export const PAYMENT_RECONCILIATION_QUEUE = 'payment-reconciliation-queue';
export const VIDEO_RECORDING_QUEUE = 'video-recording-queue';
export const VIDEO_TRANSCODING_QUEUE = 'video-transcoding-queue';
export const VIDEO_ANALYTICS_QUEUE = 'video-analytics-queue';
```

---

## 🔄 Queue Worker Registration

Update `src/libs/infrastructure/queue/src/queue.module.ts` to register new queues:

```typescript
const clinicQueues = [
  // ... existing queues
  LAB_REPORT_QUEUE,
  IMAGING_QUEUE,
  BULK_EHR_IMPORT_QUEUE,
  INVOICE_PDF_QUEUE,
  BULK_INVOICE_QUEUE,
  PAYMENT_RECONCILIATION_QUEUE,
  VIDEO_RECORDING_QUEUE,
  VIDEO_TRANSCODING_QUEUE,
  VIDEO_ANALYTICS_QUEUE,
];
```

---

## 📝 Implementation Checklist

### EHR Module
- [ ] Inject QueueService in EHRService
- [ ] Add queue processing for lab report creation
- [ ] Add queue processing for imaging/radiology reports
- [ ] Add queue processing for bulk EHR imports
- [ ] Create queue workers in QueueProcessor

### Billing Module
- [ ] Inject QueueService in BillingService
- [ ] Add queue processing for invoice PDF generation
- [ ] Add queue processing for bulk invoice creation
- [ ] Add queue processing for payment reconciliation
- [ ] Create queue workers in QueueProcessor

### Video Module
- [ ] Inject QueueService in VideoService
- [ ] Add queue processing for recording processing
- [ ] Add queue processing for video transcoding
- [ ] Add queue processing for video analytics
- [ ] Create queue workers in QueueProcessor

---

## 🎯 Benefits

1. **Non-blocking Operations**: Heavy operations don't block API responses
2. **Better Scalability**: Process jobs in background workers
3. **Retry Logic**: Automatic retries for failed jobs
4. **Monitoring**: Queue metrics and job status tracking
5. **Prioritization**: High-priority jobs processed first

---

## 📚 Related Documentation

- **Queue Service**: `src/libs/infrastructure/queue/src/queue.service.ts`
- **Queue Processor**: `src/libs/infrastructure/queue/src/queue.processor.ts`
- **Queue Module**: `src/libs/infrastructure/queue/src/queue.module.ts`

---

**Last Updated**: 2024

