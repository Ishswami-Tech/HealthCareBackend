import { describe, expect, it } from '@jest/globals';
import {
  NO_SHOW_MARK_KEY,
  NO_SHOW_UNDO_KEY,
  resolveRestoredStatus,
  wasNoShowUndone,
  withNoShowMark,
  withNoShowUndo,
} from '@services/appointments/in-person/no-show-undo.util';

const AT = new Date('2026-10-22T05:00:00Z');

describe('undo no-show rules (M4 / L3)', () => {
  it('restores the status recorded when the no-show was marked', () => {
    expect(
      resolveRestoredStatus({ metadata: withNoShowMark({}, 'CONFIRMED', AT), checkedInAt: null })
    ).toBe('CONFIRMED');
    expect(resolveRestoredStatus({ metadata: withNoShowMark({}, 'WAITING', AT) })).toBe(
      'CONFIRMED'
    );
    // A booked patient who never came goes back to SCHEDULED even if a token exists.
    expect(
      resolveRestoredStatus({ metadata: withNoShowMark({}, 'SCHEDULED', AT), tokenNumber: 3 })
    ).toBe('SCHEDULED');
  });

  it('without a mark, an arrival (checked in or holding a token) restores CONFIRMED', () => {
    expect(resolveRestoredStatus({ checkedInAt: AT })).toBe('CONFIRMED');
    expect(resolveRestoredStatus({ checkedInAt: null, tokenNumber: 7 })).toBe('CONFIRMED');
    expect(resolveRestoredStatus({ checkedInAt: null, tokenNumber: null })).toBe('SCHEDULED');
    expect(resolveRestoredStatus({ metadata: 'not an object' })).toBe('SCHEDULED');
  });

  it('marks keep the rest of the metadata (immutably)', () => {
    const original = { isWalkIn: true, priorityLabel: 'SENIOR' };
    const marked = withNoShowMark(original, 'confirmed', AT);
    expect(marked).toEqual({
      isWalkIn: true,
      priorityLabel: 'SENIOR',
      [NO_SHOW_MARK_KEY]: { previousStatus: 'CONFIRMED', markedAt: AT.toISOString() },
    });
    expect(original).toEqual({ isWalkIn: true, priorityLabel: 'SENIOR' });
    const undone = withNoShowUndo(marked, 'CONFIRMED', AT, 'user-1');
    expect(undone[NO_SHOW_MARK_KEY]).toEqual(marked[NO_SHOW_MARK_KEY]);
    expect(undone[NO_SHOW_UNDO_KEY]).toEqual({
      restoredStatus: 'CONFIRMED',
      undoneAt: AT.toISOString(),
      undoneBy: 'user-1',
    });
  });

  it('a repeated undo is recognised; a visit that was never a no-show is not (409)', () => {
    expect(wasNoShowUndone(withNoShowUndo({}, 'SCHEDULED', AT, 'u'))).toBe(true);
    expect(wasNoShowUndone({})).toBe(false);
    expect(wasNoShowUndone(withNoShowMark({}, 'CONFIRMED', AT))).toBe(false);
    expect(wasNoShowUndone(null)).toBe(false);
  });
});
