import { describe, it, expect } from '@jest/globals';
import {
  isRescheduleStatusAllowed,
  rescheduleStatusFilter,
  rescheduleStatusRefusal,
  statusAfterReschedule,
} from '@services/appointments/core/reschedule-policy';

const ALL_STATUSES = [
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'EXPIRED',
  'FOLLOW_UP_SCHEDULED',
  'AWAITING_SLOT_CONFIRMATION',
];

describe('reschedule policy', () => {
  describe('video appointments', () => {
    it.each(ALL_STATUSES)('%s -> allowed only for CONFIRMED', status => {
      expect(isRescheduleStatusAllowed('VIDEO_CALL', status)).toBe(status === 'CONFIRMED');
    });

    it('is case-insensitive and writes only from CONFIRMED', () => {
      expect(isRescheduleStatusAllowed('video_call', 'confirmed')).toBe(true);
      expect(rescheduleStatusFilter('VIDEO_CALL')).toEqual({ in: ['CONFIRMED'] });
      expect(statusAfterReschedule('VIDEO_CALL', 'CONFIRMED')).toBe('CONFIRMED');
    });

    it('says what is allowed', () => {
      expect(rescheduleStatusRefusal('VIDEO_CALL')).toMatch(
        /only be rescheduled while they are confirmed/
      );
    });
  });

  describe('in-person appointments', () => {
    const blocked = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'IN_PROGRESS'];
    it.each(ALL_STATUSES)('%s -> allowed unless over or in progress', status => {
      expect(isRescheduleStatusAllowed('IN_PERSON', status)).toBe(!blocked.includes(status));
    });

    it('treats every non-video type as in-person', () => {
      expect(isRescheduleStatusAllowed('CONSULTATION', 'PENDING')).toBe(true);
      expect(isRescheduleStatusAllowed(undefined, 'SCHEDULED')).toBe(true);
    });

    it('writes with a notIn filter on the blocked statuses', () => {
      expect(rescheduleStatusFilter('IN_PERSON')).toEqual({ notIn: blocked });
    });

    it('resets arrival-implying statuses to SCHEDULED and keeps booking statuses', () => {
      expect(statusAfterReschedule('IN_PERSON', 'CONFIRMED')).toBe('SCHEDULED');
      expect(statusAfterReschedule('IN_PERSON', 'WAITING')).toBe('SCHEDULED');
      expect(statusAfterReschedule('IN_PERSON', 'SCHEDULED')).toBe('SCHEDULED');
      expect(statusAfterReschedule('IN_PERSON', 'PENDING')).toBe('PENDING');
      expect(statusAfterReschedule('IN_PERSON', 'FOLLOW_UP_SCHEDULED')).toBe('FOLLOW_UP_SCHEDULED');
    });

    it('says what is refused', () => {
      expect(rescheduleStatusRefusal('IN_PERSON')).toMatch(
        /completed, cancelled, a no-show, expired or in progress/
      );
    });
  });
});
