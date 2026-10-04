/// <reference types="jest" />

/**
 * Cover replacement is a compare-and-set on the previous `coverImageKey` with a
 * bounded retry. These specs run overlapping uploads against the in-memory store
 * plus a fake bucket and assert the end state: the objects left in storage are
 * exactly the one the row references, and nothing the row references is deleted.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  CLINIC_ID,
  DOCTOR,
  JPEG_BYTES,
  POST_ID,
  createStatefulHarness,
  installFakeObjectStorage,
  makeFile,
  makeRow,
  rejectionsOf,
} from './health-library.test-utils';
import type { FakeObjectStorage, StatefulHarness } from './health-library.test-utils';

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

const OLD_KEY = 'library-covers/old-cover.png';

interface Setup {
  h: StatefulHarness;
  storage: FakeObjectStorage;
  referencedKey: () => string | null | undefined;
}

function setup(initialKey: string | null = OLD_KEY): Setup {
  const h = createStatefulHarness([
    makeRow({
      status: 'DRAFT',
      coverImageKey: initialKey,
      coverImageUrl: initialKey ? `https://cdn.example.com/${initialKey}` : null,
    }),
  ]);
  const referencedKey = (): string | null | undefined => h.store.get(POST_ID)?.coverImageKey;
  const storage = installFakeObjectStorage(
    h,
    initialKey ? [initialKey] : [],
    key => key === referencedKey()
  );
  return { h, storage, referencedKey };
}

const upload = (h: StatefulHarness): ReturnType<StatefulHarness['service']['setCoverImage']> =>
  h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR);

describe('HealthLibraryService.setCoverImage under concurrency', () => {
  it('leaves exactly the referenced object in storage after two overlapping uploads', async () => {
    const { h, storage, referencedKey } = setup();

    const results = await Promise.all([upload(h), upload(h)]);

    expect(results).toHaveLength(2);
    // Both uploads were stored and both raced the same compare-and-set.
    expect(h.uploadFile).toHaveBeenCalledTimes(2);
    expect(h.post.updateMany.mock.calls.length).toBeGreaterThan(2);
    const finalKey = referencedKey();
    expect(finalKey).toEqual(expect.stringMatching(/^library-covers\/upload-\d+\.jpg$/));
    expect(storage.objects()).toEqual([finalKey]);
    expect(storage.deletedWhileReferenced()).toEqual([]);
    // Each replaced object was removed exactly once (old cover + the first winner).
    expect(new Set(storage.deleted()).size).toBe(storage.deleted().length);
    expect(storage.deleted()).toContain(OLD_KEY);
  });

  it('keeps the invariant with more uploaders than retry attempts: losers get 409 and clean up', async () => {
    const { h, storage, referencedKey } = setup();

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => upload(h)));

    const rejected = rejectionsOf(results);
    expect(results.filter(result => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(
      1
    );
    for (const reason of rejected) {
      expect(reason).toBeInstanceOf(ConflictException);
    }
    expect(storage.objects()).toEqual([referencedKey()]);
    expect(storage.deletedWhileReferenced()).toEqual([]);
  });

  it('works the same for a post that had no cover yet (CAS on a null key)', async () => {
    const { h, storage, referencedKey } = setup(null);

    await Promise.all([upload(h), upload(h)]);

    expect(storage.objects()).toEqual([referencedKey()]);
    expect(storage.deleted()).toHaveLength(1);
    expect(storage.deletedWhileReferenced()).toEqual([]);
  });

  it('deletes the just-stored object and keeps the old cover when the DB update fails', async () => {
    const { h, storage, referencedKey } = setup();
    const dbError = new Error('connection reset');
    h.post.updateMany.mockRejectedValueOnce(dbError);

    await expect(upload(h)).rejects.toBe(dbError);

    expect(referencedKey()).toBe(OLD_KEY);
    expect(storage.objects()).toEqual([OLD_KEY]);
    expect(storage.deleted()).toEqual(['library-covers/upload-1.jpg']);
  });

  it('gives up with 409 after 3 attempts against a rival that always wins, deleting only its own object', async () => {
    const { h, storage } = setup();
    let rival = 0;
    h.post.updateMany.mockImplementation(async args => {
      // Another writer swaps the cover right before every attempt of this call.
      rival += 1;
      h.store.mutate(POST_ID, { coverImageKey: `library-covers/rival-${rival}.png` });
      return h.store.delegate.updateMany(args);
    });

    await expect(upload(h)).rejects.toBeInstanceOf(ConflictException);

    expect(h.post.updateMany).toHaveBeenCalledTimes(3);
    expect(storage.deleted()).toEqual(['library-covers/upload-1.jpg']);
    expect(storage.deletedWhileReferenced()).toEqual([]);
  });

  describe('racing a soft delete', () => {
    it('deletes its new object and 404s when the post was deleted before the swap committed', async () => {
      const { h, storage } = setup();
      h.post.updateMany.mockImplementationOnce(async args => {
        await h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR);
        return h.store.delegate.updateMany(args);
      });

      await expect(upload(h)).rejects.toBeInstanceOf(NotFoundException);

      // softDelete removed the old cover; the upload cleaned up after itself.
      expect(storage.objects()).toEqual([]);
    });

    it('removes the cover that was swapped in after softDelete read the row (no orphan)', async () => {
      const { h, storage } = setup();
      h.post.updateMany.mockImplementationOnce(async args => {
        // A cover swap commits after softDelete's pre-check but before its write.
        await upload(h);
        return h.store.delegate.updateMany(args);
      });

      await h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR);

      expect(h.store.get(POST_ID)?.deletedAt).toBeInstanceOf(Date);
      expect(storage.objects()).toEqual([]);
    });
  });
});
