/**
 * Short, jittered retries for the per doctor/day queue lock (L2). The lock guards a read-modify-
 * write that takes a few milliseconds; a concurrent click used to get "Queue is busy" at once.
 * Now it tries `attempts` times with a random wait between `minDelayMs` and `maxDelayMs`
 * (default 3 tries, ~300 ms in the worst case) before giving up.
 */

export interface LockRetryPolicy {
  attempts: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export const QUEUE_LOCK_RETRY: Readonly<LockRetryPolicy> = {
  attempts: 3,
  minDelayMs: 75,
  maxDelayMs: 150,
};

function waitMs(milliseconds: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

/** Random delay in [min, max] (inclusive). */
export function jitteredDelay(policy: LockRetryPolicy, random: () => number = Math.random): number {
  const span = Math.max(0, policy.maxDelayMs - policy.minDelayMs);
  return policy.minDelayMs + Math.round(random() * span);
}

/**
 * Calls `tryAcquire` until it answers true or the attempts run out. A throwing attempt (cache
 * client down) counts as "not acquired". Waits only BETWEEN attempts.
 */
export async function acquireWithRetry(
  tryAcquire: () => Promise<boolean>,
  policy: LockRetryPolicy = QUEUE_LOCK_RETRY,
  sleep: (ms: number) => Promise<void> = waitMs,
  random: () => number = Math.random
): Promise<boolean> {
  const attempts = Math.max(1, Math.floor(policy.attempts));
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const acquired = await tryAcquire().catch(() => false);
    if (acquired) return true;
    if (attempt < attempts) await sleep(jitteredDelay(policy, random));
  }
  return false;
}
