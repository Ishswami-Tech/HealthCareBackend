/**
 * QUEUE CONSTANTS — Single Source of Truth
 * =========================================
 * All background jobs route through HEALTHCARE_QUEUE.
 * Job routing is handled by the JobType enum in @core/types/queue.types.ts.
 */

// The single, unified BullMQ queue for all backend background tasks
export const HEALTHCARE_QUEUE = 'healthcare-queue';

// Queue priorities
export const QUEUE_PRIORITIES = {
  CRITICAL: 10,
  HIGH: 7,
  NORMAL: 5,
  LOW: 3,
  BACKGROUND: 1,
} as const;

// Queue delays
export const QUEUE_DELAYS = {
  IMMEDIATE: 0,
  SHORT: 5000, // 5 seconds
  MEDIUM: 30000, // 30 seconds
  LONG: 300000, // 5 minutes
  SCHEDULED: 0, // Use specific timestamp
} as const;

// Healthcare queue configuration
export const HEALTHCARE_QUEUE_CONFIG = {
  maxRetries: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
  attempts: 3,
} as const;
