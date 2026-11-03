/**
 * Help-chat inbox flags for the front desk (pure, unit-tested without the database).
 *
 * The assistant answers every patient message automatically, so "needs a reply" means a patient
 * wrote after the last STAFF message. `unreadCount` is how many patient messages that is (there
 * is no per-staff read receipt; a staff reply marks the thread handled).
 */

export interface SupportSummaryMessage {
  senderType: string;
  createdAt: Date;
}

export interface SupportThreadSummary {
  lastMessageAt: Date | null;
  unreadCount: number;
  needsReply: boolean;
  unread: boolean;
}

/** `messages` in any order; only the newest page is needed (unread counts saturate at it). */
export function summarizeSupportThread(
  messages: readonly SupportSummaryMessage[],
  fallbackLastAt: Date | null = null
): SupportThreadSummary {
  const ordered = [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let unreadCount = 0;
  for (const message of ordered) {
    const sender = message.senderType.toUpperCase();
    if (sender === 'STAFF') break;
    if (sender === 'PATIENT') unreadCount += 1;
  }
  return {
    lastMessageAt: ordered[0]?.createdAt ?? fallbackLastAt,
    unreadCount,
    needsReply: unreadCount > 0,
    unread: unreadCount > 0,
  };
}

/** Threads by their latest message, newest first (null last). */
export function compareByLastMessageDesc(
  a: { lastMessageAt: Date | null },
  b: { lastMessageAt: Date | null }
): number {
  return (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0);
}
