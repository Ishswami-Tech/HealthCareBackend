/**
 * Collects audit-log rows and writes them together.
 *
 * Every log line that is kept in the database used to be its own INSERT, so one request that logged
 * several lines issued several identical INSERTs back to back (Sentry flags that as an N+1). Rows
 * are held for a short moment and written as one batch.
 *
 * Rows are operational log lines, not clinical records: if a write fails the batch is dropped and
 * the caller is told, the same as the single-row write it replaces.
 */

export interface AuditLogRow {
  readonly userId: string;
  readonly action: string;
  readonly description: string;
  readonly ipAddress: string | null;
  readonly device: string | null;
  readonly clinicId: string | null;
}

export type AuditLogBatchWriter = (rows: readonly AuditLogRow[]) => Promise<void>;

export interface AuditLogBatcherOptions {
  /** Write at once when this many rows are waiting. */
  readonly maxRows: number;
  /** Otherwise write this long after the first waiting row. */
  readonly delayMs: number;
  /** Rows beyond this are dropped while a write is failing or slow, so memory stays bounded. */
  readonly maxQueued: number;
  readonly onError: (error: unknown) => void;
}

export const DEFAULT_AUDIT_BATCH_OPTIONS = {
  maxRows: 50,
  delayMs: 1000,
  maxQueued: 2000,
} as const;

export class AuditLogBatcher {
  private queue: AuditLogRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: AuditLogBatchWriter,
    private readonly options: AuditLogBatcherOptions
  ) {}

  add(row: AuditLogRow): void {
    if (this.queue.length >= this.options.maxQueued) return;
    this.queue = [...this.queue, row];
    if (this.queue.length >= this.options.maxRows) {
      void this.flush();
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => void this.flush(), this.options.delayMs);
      // A waiting batch must never keep the process alive; shutdown flushes it explicitly.
      this.timer.unref();
    }
  }

  /** Writes what is waiting. Writes run one after another, never overlapping. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const rows = this.queue;
    if (rows.length === 0) return this.writing;
    this.queue = [];
    this.writing = this.writing.then(async () => {
      try {
        await this.write(rows);
      } catch (error) {
        this.options.onError(error);
      }
    });
    return this.writing;
  }

  get pending(): number {
    return this.queue.length;
  }
}
