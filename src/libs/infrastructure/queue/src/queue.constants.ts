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

/**
 * Health-metric windowing.
 *
 * Error rate and throughput MUST be derived from a trailing time window, never
 * from lifetime job counts. BullMQ retains the newest `removeOnFail` failures
 * indefinitely, so a lifetime ratio stays pinned by old failures forever: a
 * single bad deploy that failed 47 jobs kept `healthcare-queue` reporting
 * "unhealthy" (53% error rate) for two months after the bug was fixed and
 * every subsequent job had succeeded.
 *
 * The window is evaluated by reading scores from the completed/failed sorted
 * sets, whose scores are the job `finishedOn` timestamps. Entries are read
 * newest-first and counting stops at the first one older than the window, so
 * no individual job hashes are fetched.
 */
export const QUEUE_METRICS_CONFIG = {
  /** Trailing window for error-rate and throughput calculations. */
  windowMs: 15 * 60 * 1000, // 15 minutes

  /**
   * Minimum finished jobs in the window before an error rate is trusted.
   * Without this, the first job failing after an idle spell reads as 100%.
   */
  minSampleSize: 5,

  /**
   * Minimum gap between metric refreshes per queue. `updateMonitoringMetrics`
   * is invoked on every `addJob`, so without throttling a burst of enqueues
   * means a burst of Redis round-trips on the shared connection.
   */
  refreshIntervalMs: 5000,

  /**
   * Completed jobs sampled to derive average processing time. Bounded on
   * purpose: an unbounded per-job fetch here previously caused cascading
   * Redis "Command timed out" errors on unrelated session/RBAC reads.
   */
  processingTimeSampleSize: 10,

  /**
   * Upper bound on sorted-set entries scanned per state when measuring the
   * window. Entries are score-ordered and read newest-first, so this only caps
   * the count for queues far busier than the retention settings keep; it keeps
   * the read bounded regardless of how large `removeOnComplete` grows.
   */
  maxWindowSamples: 500,
} as const;

/**
 * Dead-letter queue (DLQ) configuration.
 *
 * Jobs that exhaust all retry attempts are routed to a dedicated DLQ
 * instead of being silently discarded. The DLQ preserves the full job
 * payload, error stack, and attempted timestamps for investigation.
 *
 * Operationally:
 *   - Inspect DLQ via QueueMonitoringService.getFailedJobs() or the queue dashboard
 *   - Retry a DLQ job via queueService.retryDeadLetter(jobId)
 *   - Purge DLQ via queueService.purgeDeadLetter()
 */
export const DEAD_LETTER_QUEUE = 'healthcare-queue-dead-letter';

export const DLQ_CONFIG = {
  // Mirror main queue's "removeOnFail" behavior — keep failed jobs forever,
  // not just the most-recent 500, so they don't disappear before ops sees them.
  removeOnComplete: 0,
  removeOnFail: 0,
} as const;
