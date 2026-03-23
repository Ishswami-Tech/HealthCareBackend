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
//   - Single unified queue (QueueService.HEALTHCARE_QUEUE)
//   - Queue priorities (QueueService.PRIORITIES)
//   - All types and interfaces
//   - Health monitoring
//   - Metrics and monitoring
//
// Example:
//   await queueService.addJob(JobType.ANALYTICS, 'process-data', data, {
//     priority: QueueService.PRIORITIES.NORMAL
//   });

// Main exports - Single Source of Truth
export { QueueService } from './src/queue.service';
export { QueueModule } from './src/queue.module';
export { AppointmentQueueService } from './src/services/appointment-queue.service';
export { QueueController } from './src/controllers/queue.controller';

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
export { JobPriority } from './src/queue.service';

// Re-export queue constants — unified single queue
// All jobs route through HEALTHCARE_QUEUE with JobType-based routing
export {
  HEALTHCARE_QUEUE,
  QUEUE_PRIORITIES,
  QUEUE_DELAYS,
  HEALTHCARE_QUEUE_CONFIG,
} from './src/queue.constants';

// Internal exports - Only for module registration, not for direct use
// QueueHealthMonitorService is exported only for HealthService integration
// Prefer using QueueService.getHealthStatus() instead
export { QueueHealthMonitorService } from './src/queue-health-monitor.service';
