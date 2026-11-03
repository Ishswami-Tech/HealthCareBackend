import { describe, expect, it } from '@jest/globals';
import {
  compareByLastMessageDesc,
  summarizeSupportThread,
} from '../../../src/services/clinic-ops/services/support-thread-summary.util';

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 22, 10, minute));

describe('summarizeSupportThread', () => {
  it('counts patient messages after the last staff reply, skipping assistant answers', () => {
    const summary = summarizeSupportThread([
      { senderType: 'PATIENT', createdAt: at(1) },
      { senderType: 'STAFF', createdAt: at(2) },
      { senderType: 'PATIENT', createdAt: at(3) },
      { senderType: 'ASSISTANT', createdAt: at(3) },
      { senderType: 'PATIENT', createdAt: at(5) },
      { senderType: 'ASSISTANT', createdAt: at(5) },
    ]);
    expect(summary).toEqual({
      lastMessageAt: at(5),
      unreadCount: 2,
      needsReply: true,
      unread: true,
    });
  });

  it('is handled when staff replied last; empty threads fall back', () => {
    expect(
      summarizeSupportThread([
        { senderType: 'PATIENT', createdAt: at(1) },
        { senderType: 'staff', createdAt: at(2) },
      ]).needsReply
    ).toBe(false);
    expect(summarizeSupportThread([], at(9))).toEqual({
      lastMessageAt: at(9),
      unreadCount: 0,
      needsReply: false,
      unread: false,
    });
  });

  it('orders threads by latest message, null last', () => {
    const rows = [{ lastMessageAt: at(1) }, { lastMessageAt: null }, { lastMessageAt: at(7) }];
    expect([...rows].sort(compareByLastMessageDesc)).toEqual([
      { lastMessageAt: at(7) },
      { lastMessageAt: at(1) },
      { lastMessageAt: null },
    ]);
  });
});
