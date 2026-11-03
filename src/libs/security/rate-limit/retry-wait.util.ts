/**
 * Human wording for "when may I retry": "in 12 minutes (at 4:35 pm)", "in 40 seconds".
 * Always in IST, the clinic's clock. Pure, so lockout and rate-limit copy stay identical.
 */
const IST_CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

export function formatRetryWait(remainingSeconds: number, now: Date = new Date()): string {
  const seconds = Math.max(1, Math.ceil(Number.isFinite(remainingSeconds) ? remainingSeconds : 60));
  if (seconds < 60) {
    return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  const at = IST_CLOCK.format(new Date(now.getTime() + seconds * 1000))
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  return `in ${minutes} minute${minutes === 1 ? '' : 's'} (at ${at})`;
}

/** "<message>. You can try again in 12 minutes (at 4:35 pm)." */
export function withRetryWait(message: string, remainingSeconds: number, now?: Date): string {
  const base = message.trim().replace(/[.!]?$/u, '.');
  return `${base} You can try again ${formatRetryWait(remainingSeconds, now)}.`;
}
