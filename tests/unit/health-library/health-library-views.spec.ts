/// <reference types="jest" />

/**
 * View counting is de-duplicated per reader: one counted view per user per post
 * per hour (CacheService lock slot). A cache outage fails open for the read but
 * never counts. Runs against the in-memory store so the count is the real one.
 */

import { NotFoundException } from '@nestjs/common';
import { LogLevel } from '@core/types';
import type { HealthLibraryActor } from '@services/health-library/health-library.types';
import {
  CLINIC_ID,
  DOCTOR,
  PATIENT,
  POST_ID,
  createStatefulHarness,
  makeRow,
} from './health-library.test-utils';

jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/events/event.service', () => ({
  EventService: class EventService {},
}));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { LIBRARY_COVER: 'library-covers' },
  StaticAssetService: class StaticAssetService {},
}));

const OTHER_PATIENT: HealthLibraryActor = { userId: 'patient-2', role: 'PATIENT' };
const HOUR_SECONDS = 60 * 60;
const slotKey = (reader: string, postId = POST_ID): string =>
  `lock:health-library:view:${CLINIC_ID}:${postId}:${reader}`;

const publishedRow = (overrides: Parameters<typeof makeRow>[0] = {}): ReturnType<typeof makeRow> =>
  makeRow({ status: 'PUBLISHED', viewCount: 3, ...overrides });

describe('HealthLibraryService view de-duplication', () => {
  it('counts the same reader once within the hour: second read adds nothing and skips the audit write', async () => {
    const h = createStatefulHarness([publishedRow()]);

    const first = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    const second = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

    expect(first.viewCount).toBe(4);
    expect(second.viewCount).toBe(4);
    expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    expect(h.executeHealthcareWrite).toHaveBeenCalledTimes(1);
    expect(h.cache.acquireLock).toHaveBeenCalledTimes(2);
    expect(h.cache.acquireLock).toHaveBeenCalledWith(slotKey('patient-1'), HOUR_SECONDS);
  });

  it('counts different readers separately', async () => {
    const h = createStatefulHarness([publishedRow()]);

    await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    await h.service.getById(POST_ID, CLINIC_ID, false, OTHER_PATIENT);

    expect(h.store.get(POST_ID)?.viewCount).toBe(5);
    expect(h.executeHealthcareWrite).toHaveBeenCalledTimes(2);
  });

  it('cannot be inflated by a loop of sequential reads or a burst of concurrent reads', async () => {
    const h = createStatefulHarness([publishedRow()]);

    for (let index = 0; index < 50; index += 1) {
      await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    }
    await Promise.all(
      Array.from({ length: 10 }, () => h.service.getById(POST_ID, CLINIC_ID, false, PATIENT))
    );

    expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    expect(h.executeHealthcareWrite).toHaveBeenCalledTimes(1);
  });

  it('counts concurrent first reads by different readers exactly once each', async () => {
    const h = createStatefulHarness([publishedRow()]);

    await Promise.all([
      h.service.getById(POST_ID, CLINIC_ID, false, PATIENT),
      h.service.getById(POST_ID, CLINIC_ID, false, OTHER_PATIENT),
      h.service.getById(POST_ID, CLINIC_ID, false, PATIENT),
    ]);

    expect(h.store.get(POST_ID)?.viewCount).toBe(5);
  });

  it('counts the reader again once the one-hour slot has expired', async () => {
    const h = createStatefulHarness([publishedRow()]);

    await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    h.cache.advanceSeconds(HOUR_SECONDS - 1);
    await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    expect(h.store.get(POST_ID)?.viewCount).toBe(4);

    h.cache.advanceSeconds(2);
    await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    expect(h.store.get(POST_ID)?.viewCount).toBe(5);
  });

  it('keeps a separate slot per post', async () => {
    const h = createStatefulHarness([publishedRow(), publishedRow({ id: 'post-2' })]);

    await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
    await h.service.getById('post-2', CLINIC_ID, false, PATIENT);

    expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    expect(h.store.get('post-2')?.viewCount).toBe(4);
    expect(h.cache.heldKeys().sort()).toEqual([
      slotKey('patient-1'),
      slotKey('patient-1', 'post-2'),
    ]);
  });

  describe('cache unavailable (fails open for the read, never counts)', () => {
    it('serves the post without counting when the provider is not connected', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.cache.setMode('unavailable');

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.id).toBe(POST_ID);
      expect(result.viewCount).toBe(3);
      expect(h.store.get(POST_ID)?.viewCount).toBe(3);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
    });

    it('serves the post, does not count and logs a warning when the cache call throws', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.cache.setMode('throws');

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.viewCount).toBe(3);
      expect(h.store.get(POST_ID)?.viewCount).toBe(3);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('de-duplication unavailable'),
        'HealthLibraryService',
        expect.objectContaining({ postId: POST_ID, error: 'cache connection refused' })
      );
    });

    it('counts again after the cache recovers', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.cache.setMode('unavailable');
      await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      h.cache.setMode('ok');
      await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    });
  });

  describe('slot hygiene', () => {
    it('releases the slot when no row matched (post changed under the reader) so the next read counts', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.post.updateMany.mockResolvedValueOnce({ count: 0 });

      const first = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
      expect(first.viewCount).toBe(3);
      expect(h.cache.releaseLock).toHaveBeenCalledWith(slotKey('patient-1'));

      const second = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
      expect(second.viewCount).toBe(4);
      expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    });

    it('releases the slot when the count write fails so a retry is not swallowed', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.post.updateMany.mockRejectedValueOnce(new Error('db down'));

      const first = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
      expect(first.viewCount).toBe(3);
      expect(h.cache.releaseLock).toHaveBeenCalledWith(slotKey('patient-1'));

      await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);
      expect(h.store.get(POST_ID)?.viewCount).toBe(4);
    });

    it('still serves the post when releasing the slot also fails', async () => {
      const h = createStatefulHarness([publishedRow()]);
      h.post.updateMany.mockResolvedValueOnce({ count: 0 });
      h.cache.releaseLock.mockRejectedValueOnce(new Error('cache connection refused'));

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.id).toBe(POST_ID);
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('slot release failed'),
        'HealthLibraryService',
        expect.objectContaining({ postId: POST_ID })
      );
    });
  });

  describe('who is counted', () => {
    it('never touches the cache or the DB for author previews', async () => {
      const h = createStatefulHarness([publishedRow()]);

      const result = await h.service.getById(POST_ID, CLINIC_ID, true, DOCTOR);

      expect(result.viewCount).toBe(3);
      expect(h.cache.acquireLock).not.toHaveBeenCalled();
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
    });

    it('does not count (and does not touch the cache) when the reader has no identity', async () => {
      const h = createStatefulHarness([publishedRow()]);

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, {});

      expect(result.viewCount).toBe(3);
      expect(h.cache.acquireLock).not.toHaveBeenCalled();
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
    });

    it('responds 404 to a patient reading a DRAFT without claiming a slot', async () => {
      const h = createStatefulHarness([publishedRow({ status: 'DRAFT' })]);

      await expect(h.service.getById(POST_ID, CLINIC_ID, false, PATIENT)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(h.cache.acquireLock).not.toHaveBeenCalled();
    });
  });
});
