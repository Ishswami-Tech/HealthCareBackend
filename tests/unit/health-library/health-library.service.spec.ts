/// <reference types="jest" />

/**
 * Unit tests for HealthLibraryService: visibility, view counting, lifecycle
 * transitions, publish completeness, scoped writes and response shaping.
 * (Cover-image behavior lives in health-library-cover.spec.ts.)
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LogLevel } from '@core/types';
import type {
  CreateHealthLibraryPostDto,
  UpdateHealthLibraryPostDto,
} from '@dtos/health-library.dto';
import {
  CLINIC_ID,
  DOCTOR,
  PATIENT,
  POST_ID,
  createHarness,
  makeRow,
} from './health-library.test-utils';
import type { HealthLibraryHarness } from './health-library.test-utils';

// The service only needs these as DI tokens. Mocking them keeps the unit tests
// fast and independent of the S3/uuid/Prisma import graphs behind them.
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

const LIVE_ROW_SCOPE = { id: POST_ID, clinicId: CLINIC_ID, deletedAt: null };

describe('HealthLibraryService', () => {
  let h: HealthLibraryHarness;

  beforeEach(() => {
    h = createHarness();
  });

  describe('list', () => {
    it('forces status=PUBLISHED for patients even when they ask for DRAFT or ARCHIVED', async () => {
      h.post.findMany.mockResolvedValue([makeRow()]);
      h.post.count.mockResolvedValue(1);

      for (const status of ['DRAFT', 'ARCHIVED'] as const) {
        await h.service.list({ status, limit: 100 }, CLINIC_ID, false);
      }

      expect(h.post.findMany).toHaveBeenCalledTimes(2);
      for (const [args] of h.post.findMany.mock.calls) {
        expect(args).toMatchObject({
          where: { clinicId: CLINIC_ID, deletedAt: null, status: 'PUBLISHED' },
        });
      }
      for (const [args] of h.post.count.mock.calls) {
        expect(args).toMatchObject({ where: { status: 'PUBLISHED', clinicId: CLINIC_ID } });
      }
    });

    it('lets authors filter by any status, and lists every status when none is given', async () => {
      h.post.findMany.mockResolvedValue([]);
      h.post.count.mockResolvedValue(0);

      await h.service.list({ status: 'DRAFT' }, CLINIC_ID, true);
      await h.service.list({}, CLINIC_ID, true);

      const [draftArgs] = h.post.findMany.mock.calls[0] ?? [];
      const [allArgs] = h.post.findMany.mock.calls[1] ?? [];
      expect(draftArgs).toMatchObject({ where: { status: 'DRAFT' } });
      expect(allArgs).toMatchObject({ where: { clinicId: CLINIC_ID, deletedAt: null } });
      expect(allArgs?.['where']).not.toHaveProperty('status');
    });

    it('returns the {items,total} shape the mobile app reads and clamps limit/offset', async () => {
      h.post.findMany.mockResolvedValue([makeRow()]);
      h.post.count.mockResolvedValue(42);

      const result = await h.service.list({ limit: 1000, offset: -5 }, CLINIC_ID, false);

      expect(result.total).toBe(42);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: POST_ID, title: expect.any(String) as string });
      expect(h.post.findMany.mock.calls[0]?.[0]).toMatchObject({ take: 100, skip: 0 });
    });

    it('omits authorId from every item for patients but keeps it for authors', async () => {
      h.post.findMany.mockResolvedValue([makeRow(), makeRow({ id: 'post-2' })]);
      h.post.count.mockResolvedValue(2);

      const forPatient = await h.service.list({}, CLINIC_ID, false);
      const forAuthor = await h.service.list({}, CLINIC_ID, true);

      for (const item of forPatient.items) {
        expect(item).not.toHaveProperty('authorId');
        expect(item.authorName).toBe('Asha Rao');
      }
      for (const item of forAuthor.items) {
        expect(item.authorId).toBe('author-1');
      }
    });
  });

  describe('getById visibility', () => {
    it.each(['DRAFT', 'ARCHIVED'] as const)(
      'responds 404 to a patient reading a %s post and never counts a view',
      async status => {
        h.post.findFirst.mockResolvedValue(makeRow({ status }));

        await expect(h.service.getById(POST_ID, CLINIC_ID, false, PATIENT)).rejects.toBeInstanceOf(
          NotFoundException
        );
        expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      }
    );

    it('responds 404 when the post does not exist or is outside the clinic/soft-deleted', async () => {
      h.post.findFirst.mockResolvedValue(null);

      await expect(h.service.getById(POST_ID, CLINIC_ID, false, PATIENT)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(h.post.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: LIVE_ROW_SCOPE });
    });

    it('lets authors read DRAFT and ARCHIVED posts', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));

      const draft = await h.service.getById(POST_ID, CLINIC_ID, true, DOCTOR);

      expect(draft.status).toBe('DRAFT');
      expect(draft.authorId).toBe('author-1');
    });

    it('omits authorId for patients', async () => {
      h.post.findFirst.mockResolvedValue(makeRow());
      h.post.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result).not.toHaveProperty('authorId');
      expect(result.authorRole).toBe('DOCTOR');
    });
  });

  describe('getById view counting', () => {
    it('counts one view for a patient reading a PUBLISHED post, without bumping updatedAt', async () => {
      const row = makeRow({ viewCount: 3 });
      h.post.findFirst.mockResolvedValue(row);
      h.post.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.viewCount).toBe(4);
      expect(result.updatedAt).toBe(row.updatedAt.toISOString());
      expect(h.post.updateMany).toHaveBeenCalledTimes(1);
      expect(h.post.updateMany.mock.calls[0]?.[0]).toEqual({
        where: { ...LIVE_ROW_SCOPE, status: 'PUBLISHED', updatedAt: row.updatedAt },
        data: { viewCount: { increment: 1 }, updatedAt: row.updatedAt },
      });
    });

    it('attributes the write to the real reader and skips cache invalidation', async () => {
      h.post.findFirst.mockResolvedValue(makeRow());
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(h.auditOf()).toMatchObject({
        userId: 'patient-1',
        userRole: 'PATIENT',
        clinicId: CLINIC_ID,
        operation: 'VIEW',
        resourceType: 'HEALTH_LIBRARY_POST',
        resourceId: POST_ID,
        skipCacheInvalidation: true,
      });
    });

    it('does not count views for authors (previews)', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'PUBLISHED', viewCount: 9 }));

      const result = await h.service.getById(POST_ID, CLINIC_ID, true, DOCTOR);

      expect(result.viewCount).toBe(9);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.post.updateMany).not.toHaveBeenCalled();
    });

    it('keeps the stored count when the row changed under the reader (no rows matched)', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ viewCount: 3 }));
      h.post.updateMany.mockResolvedValue({ count: 0 });

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.viewCount).toBe(3);
    });

    it('logs a warning instead of swallowing the failure, and still serves the post', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ viewCount: 3 }));
      h.post.updateMany.mockRejectedValue(new Error('db down'));

      const result = await h.service.getById(POST_ID, CLINIC_ID, false, PATIENT);

      expect(result.id).toBe(POST_ID);
      expect(result.viewCount).toBe(3);
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('view count'),
        'HealthLibraryService',
        expect.objectContaining({ postId: POST_ID, error: 'db down' })
      );
    });
  });

  describe('create', () => {
    const dto: CreateHealthLibraryPostDto = {
      tab: 'ARTICLES',
      title: '  Sleep better  ',
      category: ' Sleep ',
      summary: '  Habits that help  ',
      sections: [{ heading: 'Routine', body: 'Go to bed at the same time every night.' }],
    };

    it('creates a DRAFT, trims text, never writes a cover and returns authorId to the author', async () => {
      h.post.create.mockResolvedValue(makeRow({ status: 'DRAFT' }));

      const result = await h.service.create(dto, CLINIC_ID, DOCTOR);

      const args = h.post.create.mock.calls[0]?.[0];
      expect(args).toMatchObject({
        data: {
          clinicId: CLINIC_ID,
          authorId: 'author-1',
          status: 'DRAFT',
          title: 'Sleep better',
          category: 'Sleep',
          summary: 'Habits that help',
          mediaType: 'ARTICLE',
        },
      });
      expect(args?.['data']).not.toHaveProperty('coverImageUrl');
      expect(args?.['data']).not.toHaveProperty('coverImageKey');
      expect(result.authorId).toBe('author-1');
      expect(h.emit).toHaveBeenCalledWith(
        'health-library.created',
        expect.objectContaining({ clinicId: CLINIC_ID })
      );
    });

    it('requires an authenticated user', async () => {
      await expect(h.service.create(dto, CLINIC_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.post.create).not.toHaveBeenCalled();
    });

    it('requires a videoUrl for VIDEO posts', async () => {
      await expect(
        h.service.create({ ...dto, mediaType: 'VIDEO' }, CLINIC_ID, DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.post.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('writes only the provided fields, scoped to a live row of the clinic', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.update(POST_ID, CLINIC_ID, { title: '  New title ' }, DOCTOR);

      expect(h.post.updateMany.mock.calls[0]?.[0]).toEqual({
        where: LIVE_ROW_SCOPE,
        data: { title: 'New title' },
      });
      expect(h.auditOf()).toMatchObject({ operation: 'UPDATE', userId: 'author-1' });
    });

    it('does not write anything for an empty patch', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));

      const result = await h.service.update(POST_ID, CLINIC_ID, {}, DOCTOR);

      expect(result.id).toBe(POST_ID);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
    });

    it('clears optional fields when they are patched to null', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT', whenToSeeDoctor: 'Call 112' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });
      const patch: UpdateHealthLibraryPostDto = {
        whenToSeeDoctor: null,
        readTime: null,
        videoUrl: null,
        videoDurationSeconds: null,
      };

      await h.service.update(POST_ID, CLINIC_ID, patch, DOCTOR);

      expect(h.post.updateMany.mock.calls[0]?.[0]).toMatchObject({
        data: {
          whenToSeeDoctor: null,
          readTime: null,
          videoUrl: null,
          videoDurationSeconds: null,
        },
      });
    });

    it('rejects clearing the videoUrl of a VIDEO post', async () => {
      h.post.findFirst.mockResolvedValue(
        makeRow({ status: 'DRAFT', mediaType: 'VIDEO', videoUrl: 'https://youtu.be/abc.def' })
      );

      await expect(
        h.service.update(POST_ID, CLINIC_ID, { videoUrl: null }, DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.post.updateMany).not.toHaveBeenCalled();
    });

    it('does not let an edit strip the sections from a PUBLISHED article', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'PUBLISHED' }));

      await expect(
        h.service.update(POST_ID, CLINIC_ID, { sections: [] }, DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.post.updateMany).not.toHaveBeenCalled();
    });

    it('allows emptying the sections of a DRAFT article', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.update(POST_ID, CLINIC_ID, { sections: [] }, DOCTOR);

      expect(h.post.updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { sections: [] } });
    });

    it('responds 404 when the post is gone by the time the write runs', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        h.service.update(POST_ID, CLINIC_ID, { title: 'x' }, DOCTOR)
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('publish', () => {
    it('publishes a complete DRAFT article with a scoped write and stamps publishedAt', async () => {
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT', publishedAt: null }))
        .mockResolvedValueOnce(makeRow({ status: 'PUBLISHED' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.publish(POST_ID, CLINIC_ID, DOCTOR);

      expect(result.status).toBe('PUBLISHED');
      const args = h.post.updateMany.mock.calls[0]?.[0];
      // Compare-and-set: only matches while the post is not already PUBLISHED.
      expect(args?.['where']).toEqual({ ...LIVE_ROW_SCOPE, status: { not: 'PUBLISHED' } });
      expect(args?.['data']).toMatchObject({
        status: 'PUBLISHED',
        publishedAt: expect.any(Date) as Date,
      });
      expect(h.emit).toHaveBeenCalledWith('health-library.published', {
        postId: POST_ID,
        clinicId: CLINIC_ID,
      });
    });

    it('keeps the original publishedAt when re-publishing an ARCHIVED post', async () => {
      const originalPublishedAt = new Date('2026-01-01T00:00:00.000Z');
      h.post.findFirst.mockResolvedValue(
        makeRow({ status: 'ARCHIVED', publishedAt: originalPublishedAt })
      );
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.publish(POST_ID, CLINIC_ID, DOCTOR);

      expect(h.post.updateMany.mock.calls[0]?.[0]).toMatchObject({
        data: { status: 'PUBLISHED', publishedAt: originalPublishedAt },
      });
    });

    it('responds 409 and writes nothing when the post is already PUBLISHED', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'PUBLISHED' }));

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    });

    it.each([
      ['has no sections', []],
      ['has null sections', null],
      ['only has blank sections', [{ heading: '  ', body: '   ' }]],
      ['only has sections without a body', [{ heading: 'Heading', body: '' }]],
    ])('refuses to publish an ARTICLE that %s', async (_label, sections) => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT', sections }));

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        BadRequestException
      );
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    });

    it('requires a videoUrl to publish a VIDEO and then needs no sections', async () => {
      h.post.findFirst.mockResolvedValueOnce(
        makeRow({ status: 'DRAFT', mediaType: 'VIDEO', videoUrl: null, sections: [] })
      );
      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        BadRequestException
      );

      h.post.findFirst.mockResolvedValue(
        makeRow({
          status: 'DRAFT',
          mediaType: 'VIDEO',
          videoUrl: 'https://vimeo.com/123456',
          sections: [],
        })
      );
      h.post.updateMany.mockResolvedValue({ count: 1 });
      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).resolves.toBeDefined();
    });

    it('responds 404 when the post is gone by the time the write runs', async () => {
      // Pre-check sees the DRAFT; the write matches nothing; the re-read finds no live row.
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT' }))
        .mockResolvedValueOnce(null);
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(h.emit).not.toHaveBeenCalled();
    });

    it('responds 409 (not 404) and emits nothing when the compare-and-set loses to another publish', async () => {
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT' }))
        .mockResolvedValueOnce(makeRow({ status: 'PUBLISHED' }));
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.publish(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(h.emit).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('archives a PUBLISHED post with a scoped write', async () => {
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'PUBLISHED' }))
        .mockResolvedValueOnce(makeRow({ status: 'ARCHIVED' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      const result = await h.service.archive(POST_ID, CLINIC_ID, DOCTOR);

      expect(result.status).toBe('ARCHIVED');
      expect(h.post.updateMany.mock.calls[0]?.[0]).toEqual({
        where: { ...LIVE_ROW_SCOPE, status: { not: 'ARCHIVED' } },
        data: { status: 'ARCHIVED' },
      });
    });

    it('can archive a DRAFT', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await expect(h.service.archive(POST_ID, CLINIC_ID, DOCTOR)).resolves.toBeDefined();
    });

    it('responds 409 and writes nothing when the post is already ARCHIVED', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'ARCHIVED' }));

      await expect(h.service.archive(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('marks the row deleted with a scoped write and removes the stored cover image', async () => {
      h.post.findFirst.mockResolvedValue(
        makeRow({ coverImageKey: 'library-covers/abc-cover.jpg' })
      );
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR);

      const args = h.post.updateMany.mock.calls[0]?.[0];
      expect(args?.['where']).toEqual(LIVE_ROW_SCOPE);
      expect(args?.['data']).toMatchObject({
        status: 'ARCHIVED',
        deletedAt: expect.any(Date) as Date,
      });
      expect(h.deleteAsset).toHaveBeenCalledWith('library-covers/abc-cover.jpg');
      expect(h.emit).toHaveBeenCalledWith('health-library.deleted', {
        postId: POST_ID,
        clinicId: CLINIC_ID,
      });
    });

    it('does not touch storage when the post has no cover', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ coverImageKey: null }));
      h.post.updateMany.mockResolvedValue({ count: 1 });

      await h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR);

      expect(h.deleteAsset).not.toHaveBeenCalled();
    });

    it('still succeeds, and logs, when the cover object cannot be deleted', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ coverImageKey: 'library-covers/abc.jpg' }));
      h.post.updateMany.mockResolvedValue({ count: 1 });
      h.deleteAsset.mockRejectedValueOnce(new Error('storage offline'));

      await expect(h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR)).resolves.toBeUndefined();
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('cover object delete failed'),
        'HealthLibraryService',
        expect.objectContaining({ error: 'storage offline' })
      );

      h.deleteAsset.mockResolvedValueOnce(false);
      h.post.findFirst.mockResolvedValue(makeRow({ coverImageKey: 'library-covers/abc.jpg' }));
      await expect(h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR)).resolves.toBeUndefined();
    });

    it('does not delete the cover or emit when the post vanished (nothing matched)', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ coverImageKey: 'library-covers/abc.jpg' }));
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.softDelete(POST_ID, CLINIC_ID, DOCTOR)).rejects.toBeInstanceOf(
        NotFoundException
      );
      expect(h.deleteAsset).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    });
  });
});
