import { describe, expect, it } from '@jest/globals';
import {
  LIVE_QUEUE_INDEX_SENTINEL,
  isLiveQueueIndexBackfilled,
  liveQueueDayPattern,
  liveQueueIndexKey,
  liveQueueKeysOfIndex,
  parseLiveQueueKey,
} from '../../../src/libs/infrastructure/queue/src/services/live-queue-index.util';

const CLINIC = '6fd5490c-f2b2-4bde-aafa-d58f2ada5d71';

describe('parseLiveQueueKey', () => {
  it('reads domain, clinic and day of a doctor list', () => {
    expect(parseLiveQueueKey(`queue:clinic:${CLINIC}:doc-1:2026-10-22`)).toEqual({
      domain: 'clinic',
      clinicId: CLINIC,
      day: '2026-10-22',
    });
  });

  it('accepts an owner id that contains colons (medicine desk)', () => {
    expect(
      parseLiveQueueKey(`queue:medicine-desk:${CLINIC}:medicine-desk:${CLINIC}:2026-10-22`)
    ).toEqual({ domain: 'medicine-desk', clinicId: CLINIC, day: '2026-10-22' });
  });

  it('rejects keys that are not live lists', () => {
    expect(parseLiveQueueKey(`queue:clinic:${CLINIC}:2026-10-22`)).toBeNull();
    expect(parseLiveQueueKey(`queue:clinic:${CLINIC}:doc-1:not-a-day`)).toBeNull();
    expect(parseLiveQueueKey(`cache:clinic:${CLINIC}:doc-1:2026-10-22`)).toBeNull();
    expect(parseLiveQueueKey('')).toBeNull();
  });
});

describe('index keys', () => {
  it('lives outside the queue:* namespace and is per clinic / domain / day', () => {
    const key = liveQueueIndexKey('clinic', CLINIC, '2026-10-22');
    expect(key).toBe(`queue-index:clinic:${CLINIC}:2026-10-22`);
    expect(key.startsWith('queue:')).toBe(false);
    expect(liveQueueIndexKey('clinic', CLINIC, '2026-10-23')).not.toBe(key);
  });

  it('keeps the SCAN glob it replaces for the one-time fallback', () => {
    expect(liveQueueDayPattern('clinic', CLINIC, '2026-10-22')).toBe(
      `queue:clinic:${CLINIC}:*:2026-10-22`
    );
  });
});

describe('index members', () => {
  it('is backfilled only once the sentinel is present', () => {
    expect(isLiveQueueIndexBackfilled([])).toBe(false);
    expect(isLiveQueueIndexBackfilled(['queue:clinic:c:d:2026-10-22'])).toBe(false);
    expect(isLiveQueueIndexBackfilled([LIVE_QUEUE_INDEX_SENTINEL])).toBe(true);
  });

  it('returns the queue keys without the sentinel, de-duplicated and sorted', () => {
    expect(
      liveQueueKeysOfIndex([
        'queue:clinic:c:b:2026-10-22',
        LIVE_QUEUE_INDEX_SENTINEL,
        'queue:clinic:c:a:2026-10-22',
        'queue:clinic:c:b:2026-10-22',
      ])
    ).toEqual(['queue:clinic:c:a:2026-10-22', 'queue:clinic:c:b:2026-10-22']);
  });
});
