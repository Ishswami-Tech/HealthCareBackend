/// <reference types="jest" />

/**
 * Guards the test double itself: the race specs are only meaningful if the fake
 * `updateMany` honours the whole `where` atomically, so pin that down here.
 */

import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { createPostStore } from './health-library.fake-store';
import { CLINIC_ID, POST_ID, makeRow } from './health-library.test-utils';

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

const live = { id: POST_ID, clinicId: CLINIC_ID, deletedAt: null };
const update = (where: PrismaDelegateArgs, data: PrismaDelegateArgs): PrismaDelegateArgs => ({
  where,
  data,
});

describe('in-memory post store', () => {
  it('matches equality, null (IS NULL), not, in and equals', async () => {
    const store = createPostStore([makeRow({ status: 'DRAFT', coverImageKey: null })]);
    const { updateMany } = store.delegate;

    expect((await updateMany(update({ ...live, status: 'PUBLISHED' }, { title: 'x' }))).count).toBe(
      0
    );
    expect(
      (await updateMany(update({ ...live, status: { not: 'DRAFT' } }, { title: 'x' }))).count
    ).toBe(0);
    expect(
      (await updateMany(update({ ...live, status: { in: ['ARCHIVED'] } }, { title: 'x' }))).count
    ).toBe(0);
    expect((await updateMany(update({ ...live, coverImageKey: 'k' }, { title: 'x' }))).count).toBe(
      0
    );
    expect(store.get(POST_ID)?.title).not.toBe('x');

    expect(
      (await updateMany(update({ ...live, status: { not: 'PUBLISHED' } }, { title: 'a' }))).count
    ).toBe(1);
    expect(
      (await updateMany(update({ ...live, status: { in: ['DRAFT', 'ARCHIVED'] } }, { title: 'b' })))
        .count
    ).toBe(1);
    expect((await updateMany(update({ ...live, coverImageKey: null }, { title: 'c' }))).count).toBe(
      1
    );
    expect(
      (await updateMany(update({ ...live, status: { equals: 'DRAFT' } }, { title: 'd' }))).count
    ).toBe(1);
    expect(store.get(POST_ID)?.title).toBe('d');
  });

  it('scopes by id, clinic and soft delete', async () => {
    const store = createPostStore([makeRow(), makeRow({ id: 'post-2', deletedAt: new Date() })]);
    const { updateMany } = store.delegate;

    expect(
      (await updateMany(update({ ...live, clinicId: 'clinic-2' }, { title: 'x' }))).count
    ).toBe(0);
    expect((await updateMany(update({ ...live, id: 'post-2' }, { title: 'x' }))).count).toBe(0);
    expect((await updateMany(update(live, { title: 'ok' }))).count).toBe(1);
  });

  it('compares Date values by time, not identity', async () => {
    const updatedAt = new Date('2026-09-02T00:00:00.000Z');
    const store = createPostStore([makeRow({ updatedAt })]);

    const same = await store.delegate.updateMany(
      update({ ...live, updatedAt: new Date(updatedAt.getTime()) }, { title: 'x' })
    );
    const other = await store.delegate.updateMany(
      update({ ...live, updatedAt: new Date('2026-01-01T00:00:00.000Z') }, { title: 'y' })
    );

    expect(same.count).toBe(1);
    expect(other.count).toBe(0);
  });

  it('applies increments, and bumps updatedAt like @updatedAt unless the caller sets it', async () => {
    const before = new Date('2026-09-02T00:00:00.000Z');
    const now = new Date('2026-10-01T00:00:00.000Z');
    const store = createPostStore([makeRow({ viewCount: 3, updatedAt: before })], {
      now: () => now,
    });

    await store.delegate.updateMany(update(live, { title: 'edit' }));
    expect(store.get(POST_ID)?.updatedAt).toEqual(now);

    await store.delegate.updateMany(
      update(live, { viewCount: { increment: 1 }, updatedAt: before })
    );
    expect(store.get(POST_ID)).toMatchObject({ viewCount: 4, updatedAt: before });
  });

  it('is atomic: of two overlapping identical compare-and-set writes exactly one matches', async () => {
    const store = createPostStore([makeRow({ status: 'DRAFT' })]);
    const where: PrismaDelegateArgs = { ...live, status: { not: 'PUBLISHED' } };

    const [first, second] = await Promise.all([
      store.delegate.updateMany(update(where, { status: 'PUBLISHED' })),
      store.delegate.updateMany(update(where, { status: 'PUBLISHED' })),
    ]);

    expect([first.count, second.count].sort()).toEqual([0, 1]);
    expect(store.statusHistory()).toEqual(['PUBLISHED']);
  });

  it('fails loudly on where operators it does not model instead of silently matching', async () => {
    const store = createPostStore([makeRow()]);

    await expect(
      store.delegate.updateMany(update({ ...live, viewCount: { gt: 1 } }, { title: 'x' }))
    ).rejects.toThrow('unsupported where operator "gt"');
    await expect(store.delegate.findMany({ where: { OR: [{ id: POST_ID }] } })).rejects.toThrow(
      'unsupported where clause "OR"'
    );
  });

  it('returns copies, so callers cannot mutate stored rows', async () => {
    const store = createPostStore([makeRow()]);

    const row = await store.delegate.findFirst({ where: live });
    row?.sections?.push({ heading: 'injected', body: 'x' });

    expect(store.get(POST_ID)?.sections).toHaveLength(1);
  });
});
