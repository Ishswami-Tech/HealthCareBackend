/// <reference types="jest" />

/**
 * readTime is derived with one calculation for create AND update, so it can no
 * longer go stale after a content edit. An explicit readTime always wins.
 */

import type { UpdateHealthLibraryPostDto } from '@dtos/health-library.dto';
import { computeReadTime } from '@services/health-library/health-library-content.util';
import {
  CLINIC_ID,
  DOCTOR,
  POST_ID,
  createHarness,
  createStatefulHarness,
  makeRow,
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

const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
const longSection = { heading: 'Deep dive', body: words(600) };

async function patch(h: StatefulHarness, dto: UpdateHealthLibraryPostDto): Promise<string | null> {
  const result = await h.service.update(POST_ID, CLINIC_ID, dto, DOCTOR);
  return result.readTime;
}

describe('computeReadTime', () => {
  it('estimates articles at 200 words per minute, minimum 1 minute', () => {
    expect(computeReadTime('ARTICLE', undefined, [{ heading: 'a', body: words(600) }])).toBe(
      '3 min read'
    );
    expect(
      computeReadTime('ARTICLE', undefined, [{ heading: 'a', body: 'five words is all' }])
    ).toBe('1 min read');
  });

  it('estimates videos from their duration, minimum 1 minute', () => {
    expect(computeReadTime('VIDEO', 600, [])).toBe('10 min watch');
    expect(computeReadTime('VIDEO', 10, [])).toBe('1 min watch');
  });

  it('returns null when there is nothing to estimate from', () => {
    expect(computeReadTime('ARTICLE', undefined, [])).toBeNull();
    expect(computeReadTime('ARTICLE', undefined, null)).toBeNull();
    expect(computeReadTime('VIDEO', null, [])).toBeNull();
    expect(computeReadTime('VIDEO', 0, [])).toBeNull();
  });

  it('skips malformed sections coming from the JSON column instead of throwing', () => {
    const malformed = [{ heading: 'ok', body: words(200) }, { heading: 'x' }, null] as never;

    expect(computeReadTime('ARTICLE', undefined, malformed)).toBe('1 min read');
  });
});

describe('HealthLibraryService readTime', () => {
  const draft = (overrides: Parameters<typeof makeRow>[0] = {}): ReturnType<typeof makeRow> =>
    makeRow({ status: 'DRAFT', readTime: '1 min read', ...overrides });

  it('computes it on create when none is given, and an explicit one wins', async () => {
    const h = createHarness();
    h.post.create.mockResolvedValue(draft());
    const base = {
      tab: 'ARTICLES' as const,
      title: 'Sleep',
      category: 'Sleep',
      summary: 'Habits',
      sections: [longSection],
    };

    await h.service.create(base, CLINIC_ID, DOCTOR);
    await h.service.create({ ...base, readTime: ' 9 min read ' }, CLINIC_ID, DOCTOR);

    expect(h.post.create.mock.calls[0]?.[0]).toMatchObject({ data: { readTime: '3 min read' } });
    expect(h.post.create.mock.calls[1]?.[0]).toMatchObject({ data: { readTime: '9 min read' } });
  });

  describe('recomputed on update when the content it depends on changes', () => {
    it('after a sections edit makes the article longer', async () => {
      const h = createStatefulHarness([draft()]);

      await expect(patch(h, { sections: [longSection] })).resolves.toBe('3 min read');
      expect(h.store.get(POST_ID)?.readTime).toBe('3 min read');
    });

    it('after a sections edit makes the article shorter', async () => {
      const h = createStatefulHarness([draft({ readTime: '3 min read', sections: [longSection] })]);

      await expect(
        patch(h, { sections: [{ heading: 'Brief', body: 'Just a few words here.' }] })
      ).resolves.toBe('1 min read');
    });

    it('to null when the sections of a DRAFT are emptied', async () => {
      const h = createStatefulHarness([draft()]);

      await expect(patch(h, { sections: [] })).resolves.toBeNull();
    });

    it('for a PUBLISHED article too', async () => {
      const h = createStatefulHarness([makeRow({ status: 'PUBLISHED', readTime: '1 min read' })]);

      await expect(patch(h, { sections: [longSection] })).resolves.toBe('3 min read');
    });

    it('when the video duration changes', async () => {
      const h = createStatefulHarness([
        draft({
          mediaType: 'VIDEO',
          videoUrl: 'https://youtu.be/abc.def',
          videoDurationSeconds: 120,
          readTime: '2 min watch',
          sections: [],
        }),
      ]);

      await expect(patch(h, { videoDurationSeconds: 600 })).resolves.toBe('10 min watch');
    });

    it('when the media type switches to VIDEO in the same patch as its duration', async () => {
      const h = createStatefulHarness([draft()]);

      await expect(
        patch(h, {
          mediaType: 'VIDEO',
          videoUrl: 'https://vimeo.com/123456',
          videoDurationSeconds: 300,
        })
      ).resolves.toBe('5 min watch');
    });
  });

  describe('left alone', () => {
    it('when the edit does not touch sections, media type or duration', async () => {
      const h = createStatefulHarness([draft({ readTime: '7 min read' })]);

      await expect(patch(h, { title: 'A new title', summary: 'A new summary' })).resolves.toBe(
        '7 min read'
      );
      const data = h.post.updateMany.mock.calls[0]?.[0]?.['data'];
      expect(data).not.toHaveProperty('readTime');
    });

    it('when the client sends an explicit readTime together with new sections', async () => {
      const h = createStatefulHarness([draft()]);

      await expect(patch(h, { sections: [longSection], readTime: ' 10 min ' })).resolves.toBe(
        '10 min'
      );
    });

    it('cleared (null) when the client explicitly clears it, even alongside a content edit', async () => {
      const h = createStatefulHarness([draft()]);

      await expect(patch(h, { sections: [longSection], readTime: null })).resolves.toBeNull();
    });
  });
});
