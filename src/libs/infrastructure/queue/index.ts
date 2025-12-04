// ========================================
// QUEUE MODULE - SINGLE SOURCE OF TRUTH
// ========================================
//
// This module exports ONLY QueueService and QueueModule.
// QueueService is the single entry point for all queue operations.
// All other components are internal and accessed through QueueService.
//
// Usage:
//   import { QueueService, QueueModule } from '@infrastructure/queue';
//   // or
//   import { QueueService } from '@queue';
//
// QueueService provides:
//   - All queue operations (addJob, getJob, etc.)
//   - Queue constants (QueueService.ANALYTICS_QUEUE, etc.)
//   - Queue priorities (QueueService.PRIORITIES, etc.)
//   - All types and interfaces
//   - Health monitoring
//   - Metrics and monitoring
//
// Example:
//   await queueService.addJob(QueueService.ANALYTICS_QUEUE, 'job-type', data, {
//     priority: QueueService.PRIORITIES.NORMAL
//   });

// Main exports - Single Source of Truth
export { QueueService } from './src/queue.service';
export { QueueModule } from './src/queue.module';

// Re-export types from @core/types for convenience
export type {
  JobData,
  QueueFilters,
  ClientSession,
  EnterpriseJobOptions,
  BulkJobData,
  QueueName,
  QueuePriority,
} from '@core/types/queue.types';

export { AuditAction } from '@core/types/queue.types';
export { JobPriority, DomainType } from './src/queue.service';

// Re-export queue constants for convenience
// Note: Prefer using QueueService static properties (QueueService.ANALYTICS_QUEUE, etc.)
// These are exported here for direct access when needed
export {
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  SERVICE_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
  DOCTOR_AVAILABILITY_QUEUE,
  QUEUE_MANAGEMENT_QUEUE,
  PAYMENT_PROCESSING_QUEUE,
  ANALYTICS_QUEUE,
  ENHANCED_APPOINTMENT_QUEUE,
  WAITING_LIST_QUEUE,
  CALENDAR_SYNC_QUEUE,
  AYURVEDA_THERAPY_QUEUE,
  PATIENT_PREFERENCE_QUEUE,
  REMINDER_QUEUE,
  FOLLOW_UP_QUEUE,
  RECURRING_APPOINTMENT_QUEUE,
  PAYMENT_QUEUE,
  EMERGENCY_QUEUE,
  VIP_QUEUE,
  QUEUE_PRIORITIES,
} from './src/queue.constants';

// Internal exports - Only for module registration, not for direct use
// QueueHealthMonitorService is exported only for HealthService integration
// Prefer using QueueService.getHealthStatus() instead
export { QueueHealthMonitorService } from './src/queue-health-monitor.service';
