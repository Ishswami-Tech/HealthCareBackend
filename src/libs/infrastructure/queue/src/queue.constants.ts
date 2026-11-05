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

/** Plain-number retention, for callers whose option type only accepts a count. */
export const JOB_RETENTION_COUNTS = {
  removeOnComplete: 1000,
  removeOnFail: 2000,
} as const;

// Healthcare queue configuration
export const HEALTHCARE_QUEUE_CONFIG = {
  maxRetries: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: JOB_RETENTION_COUNTS.removeOnComplete,
  removeOnFail: JOB_RETENTION_COUNTS.removeOnFail,
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

/**
 * Retention of finished jobs in the main queue. BullMQ keeps every finished job hash (with its
 * payload, which can hold PHI) until `removeOnComplete` / `removeOnFail` prunes it, and Dragonfly
 * runs with `noeviction`, so an unbounded count eventually fills memory and breaks enqueues.
 * Both a count and an age cap apply (whichever is reached first).
 */
export const JOB_RETENTION = {
  removeOnComplete: { count: 1000, age: 24 * 60 * 60 }, // newest 1000, at most 24h
  removeOnFail: { count: 2000, age: 7 * 24 * 60 * 60 }, // newest 2000, at most 7 days
} as const;

/**
 * Queue notification jobs (POST /queue/notifications) are read back as the inbox, so they outlive
 * the default retention, but bounded: newest 5000, at most 7 days (they used to be kept forever).
 */
export const NOTIFICATION_JOB_RETENTION = {
  removeOnComplete: { count: 5000, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
} as const;

/**
 * DLQ retention. DLQ entries have no consumer, so they sit in the `wait` list until they are
 * retried or pruned. NOTE: `removeOnComplete/removeOnFail: 0` means "delete immediately" in
 * BullMQ, not "keep forever"; the DLQ instead keeps at most `maxEntries` entries younger than
 * `maxAgeMs`, pruned whenever a new entry is added.
 */
export const DLQ_CONFIG = {
  removeOnComplete: { count: 1000, age: 30 * 24 * 60 * 60 },
  removeOnFail: { count: 1000, age: 30 * 24 * 60 * 60 },
  maxEntries: 5000,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  /** Prune at most once per this interval (pruning is a ZRANGE/LRANGE + deletes). */
  pruneIntervalMs: 10 * 60 * 1000,
} as const;

/**
 * Worker shutdown and health.
 *
 * On SIGTERM the worker stops fetching new jobs and waits up to `closeTimeoutMs` for in-flight
 * jobs to finish before force-closing (a force-closed job is retried after the stall check). The
 * container `stop_grace_period` must be larger than `shutdownTimeoutMs`.
 */
export const WORKER_LIFECYCLE = {
  closeTimeoutMs: 25_000,
  shutdownTimeoutMs: 35_000,
  heartbeatIntervalMs: 15_000,
  /** A heartbeat older than this means the worker process is hung or dead. */
  heartbeatMaxAgeMs: 60_000,
  /**
   * Per-dependency ping timeout inside the heartbeat loop. The DB ping calls
   * DatabaseService.getHealthStatus(), which can itself run a fresh query racing its own 5s
   * timeout - 3s here meant the outer ping killed that inner check before it ever got a chance
   * to finish, failing the worker's Docker healthcheck on perfectly normal connection latency
   * (2026-11-05). Must stay above getHealthStatus()'s own 5s budget.
   */
  pingTimeoutMs: 6_000,
} as const;

/** TTL of the "job already completed" marker that makes re-delivered jobs no-ops. */
export const JOB_COMPLETION_MARKER_TTL_SECONDS = 24 * 60 * 60;
