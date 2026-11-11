/**
 * Generic "keep trying forever at a low frequency" fallback for a subscribe-type operation that
 * has no proper ready/reconnect event to hook into: once an initial fast-retry burst gives up,
 * this polls at `intervalMs` indefinitely instead of leaving the operation permanently
 * unconfirmed for the process's lifetime. Each tick runs exactly one bare attempt - callers must
 * not pass something that itself schedules further retries, or attempts will pile up.
 */
export class SlowRetryScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly attempt: () => void | Promise<void>,
    private readonly isConfirmed: () => boolean
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.isConfirmed()) {
        this.stop();
        return;
      }
      void this.attempt();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
