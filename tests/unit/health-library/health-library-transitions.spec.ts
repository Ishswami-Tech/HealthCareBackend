/// <reference types="jest" />

/**
 * Status transitions are compare-and-set writes. These specs run the service
 * against the in-memory store (real `where` semantics, interleaved awaits), so a
 * lost race really loses: exactly one publish/archive wins, the others get 409,
 * and only the winner emits its event.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CLINIC_ID,
  DOCTOR,
  POST_ID,
  createStatefulHarness,
  makeRow,
  rejectionsOf,
} from './health-library.test-utils';
import type { StatefulHarness } from './health-library.test-utils';

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

const draftRow = (): ReturnType<typeof makeRow> => makeRow({ status: 'DRAFT', publishedAt: null });

function eventNames(h: StatefulHarness): string[] {
  return h.emit.mock.calls.map(([name]) => name);
}

describe('HealthLibraryService status transitions (compare-and-set)', () => {
  describe('overlapping calls', () => {
    it.each([2, 5])(
      'lets exactly one of %i overlapping publishes win, 409s the rest and emits one event',
      async callers => {
        const h = createStatefulHarness([draftRow()]);

        const results = await Promise.allSettled(
          Array.from({ length: callers }, () => h.service.publish(POST_ID, CLINIC_ID, DOCTOR))
        );

        const winners = results.filter(result => result.status === 'fulfilled');
        const losers = rejectionsOf(results);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(callers - 1);
        for (const reason of losers) {
          expect(reason).toBeInstanceOf(ConflictException);
        }
        // They really raced: every caller passed the pre-check and attempted the write.
        expect(h.post.updateMany).toHaveBeenCalledTimes(callers);
        expect(eventNames(h)).toEqual(['health-library.published']);
        expect(h.store.get(POST_ID)?.status).toBe('PUBLISHED');
        expect(h.store.statusHistory()).toEqual(['PUBLISHED']);
      }
    );

    it('lets exactly one of two overlapping archives win and emits one event', async () => {
      const h = createStatefulHarness([makeRow({ status: 'PUBLISHED' })]);

      const results = await Promise.allSettled([
        h.service.archive(POST_ID, CLINIC_ID, DOCTOR),
        h.service.archive(POST_ID, CLINIC_ID, DOCTOR),
      ]);

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const [loser] = rejectionsOf(results);
      expect(loser).toBeInstanceOf(ConflictException);
      expect(h.post.updateMany).toHaveBeenCalledTimes(2);
      expect(eventNames(h)).toEqual(['health-library.archived']);
      expect(h.store.get(POST_ID)?.status).toBe('ARCHIVED');
    });

    it('serialises a publish racing an archive: no lost update, one event per committed transition', async () => {
      const h = createStatefulHarness([draftRow()]);

      const results = await Promise.allSettled([
        h.service.publish(POST_ID, CLINIC_ID, DOCTOR),
        h.service.archive(POST_ID, CLINIC_ID, DOCTOR),
      ]);

      // Both transitions are legal from DRAFT, so both commit — in some order.
      expect(rejectionsOf(results)).toEqual([]);
      const committed = h.store.statusHistory();
      expect([...committed].sort()).toEqual(['ARCHIVED', 'PUBLISHED']);
      // The stored status is the last committed transition...
      expect(h.store.get(POST_ID)?.status).toBe(committed[committed.length - 1]);
      // ...and every commit emitted exactly its own event (none duplicated or lost).
      expect([...eventNames(h)].sort()).toEqual([
        'health-library.archived',
        'health-library.published',
      ]);
    });

    it('lets a publish commit after an archive slipped in between its read and its write', async () => {
      const h = createStatefulHarness([draftRow()]);
      h.post.updateMany.mockImplementationOnce(async args => {
        // Another request archives the post after publish() already read the DRAFT.
        await h.service.archive(POST_ID, CLINIC_ID, DOCTOR);
        return h.store.delegate.updateMany(args);
      });

      const result = await h.service.publish(POST_ID, CLINIC_ID, DOCTOR);

      expect(result.status).toBe('PUBLISHED');
      expect(h.store.statusHistory()).toEqual(['ARCHIVED', 'PUBLISHED']);
      expect(eventNames(h)).toEqual(['health-library.archived', 'health-library.published']);
    });
  });

  describe('already in the target state', () => {
    it('responds 409 to archiving an already-archived post and writes nothing more', async () => {
      const h = createStatefulHarness([makeRow({ status: 'PUBLISHED' })]);

      await h.service.archive(POST_ID, CLINIC_ID, DOCTOR);
      await expect(h.service.archive(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        ConflictException
      );

      expect(h.post.updateMany).toHaveBeenCalledTimes(1);
      expect(eventNames(h)).toEqual(['health-library.archived']);
      expect(h.store.statusHistory()).toEqual(['ARCHIVED']);
    });

    it('responds 409 when the pre-check was stale and the post is already archived by the time the write runs', async () => {
      const h = createStatefulHarness([makeRow({ status: 'ARCHIVED' })]);
      // The pre-check reads a stale DRAFT snapshot; the guarded write must still refuse.
      h.post.findFirst.mockResolvedValueOnce(draftRow());

      const attempt = h.service.archive(POST_ID, CLINIC_ID, DOCTOR);

      await expect(attempt).rejects.toBeInstanceOf(ConflictException);
      await expect(attempt).rejects.toThrow('already archived');
      expect(h.post.updateMany).toHaveBeenCalledTimes(1);
      expect(eventNames(h)).toEqual([]);
    });

    it('responds 409 to publishing an already-published post without writing', async () => {
      const h = createStatefulHarness([makeRow({ status: 'PUBLISHED' })]);

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        ConflictException
      );

      expect(h.post.updateMany).not.toHaveBeenCalled();
      expect(eventNames(h)).toEqual([]);
    });
  });

  describe('post removed under the caller', () => {
    it('responds 404, not 409, when the post is soft-deleted between the read and the write', async () => {
      const h = createStatefulHarness([draftRow()]);
      h.post.updateMany.mockImplementationOnce(async args => {
        h.store.mutate(POST_ID, { deletedAt: new Date() });
        return h.store.delegate.updateMany(args);
      });

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(eventNames(h)).toEqual([]);
    });

    it('responds 404 for a post of another clinic and leaves it untouched', async () => {
      const h = createStatefulHarness([draftRow()]);

      await expect(h.service.publish(POST_ID, 'clinic-2', DOCTOR)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(h.store.get(POST_ID)?.status).toBe('DRAFT');
    });
  });

  it('keeps the original publishedAt when a publish follows an archive of a once-published post', async () => {
    const originalPublishedAt = new Date('2026-01-01T00:00:00.000Z');
    const h = createStatefulHarness([
      makeRow({ status: 'PUBLISHED', publishedAt: originalPublishedAt }),
    ]);

    await h.service.archive(POST_ID, CLINIC_ID, DOCTOR);
    const republished = await h.service.publish(POST_ID, CLINIC_ID, DOCTOR);

    expect(republished.publishedAt).toBe(originalPublishedAt.toISOString());
  });
});
