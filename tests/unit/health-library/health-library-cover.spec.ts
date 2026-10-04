/// <reference types="jest" />

/**
 * Unit tests for the Health Library cover-image path: magic-byte sniffing,
 * storage-result validation, orphan cleanup and scoped DB writes.
 */

import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { LogLevel } from '@core/types';
import {
  detectCoverImage,
  isAbsoluteHttpsUrl,
} from '@services/health-library/health-library-cover.util';
import {
  CLINIC_ID,
  DOCTOR,
  GIF_BYTES,
  JPEG_BYTES,
  PDF_BYTES,
  PNG_BYTES,
  POST_ID,
  WEBP_BYTES,
  createHarness,
  makeFile,
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

const NEW_KEY = 'library-covers/uuid-post-1-123.jpg';
const NEW_URL = `https://cdn.example.com/${NEW_KEY}`;
const OLD_KEY = 'library-covers/uuid-old-cover.png';

describe('detectCoverImage', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes', () => {
    expect(detectCoverImage(JPEG_BYTES)).toEqual({ mimeType: 'image/jpeg', extension: 'jpg' });
    expect(detectCoverImage(PNG_BYTES)).toEqual({ mimeType: 'image/png', extension: 'png' });
    expect(detectCoverImage(WEBP_BYTES)).toEqual({ mimeType: 'image/webp', extension: 'webp' });
  });

  it('rejects other formats, truncated data and RIFF files that are not WebP', () => {
    expect(detectCoverImage(PDF_BYTES)).toBeNull();
    expect(detectCoverImage(GIF_BYTES)).toBeNull();
    expect(detectCoverImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectCoverImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectCoverImage(Buffer.alloc(0))).toBeNull();
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    expect(detectCoverImage(wav)).toBeNull();
  });
});

describe('isAbsoluteHttpsUrl', () => {
  it('accepts only absolute https URLs', () => {
    expect(isAbsoluteHttpsUrl('https://cdn.example.com/a.jpg')).toBe(true);
    expect(isAbsoluteHttpsUrl('http://cdn.example.com/a.jpg')).toBe(false);
    expect(isAbsoluteHttpsUrl('/storage/assets/library-covers/a.jpg')).toBe(false);
    expect(isAbsoluteHttpsUrl('s3://bucket/library-covers/a.jpg')).toBe(false);
    expect(isAbsoluteHttpsUrl('')).toBe(false);
    expect(isAbsoluteHttpsUrl(undefined)).toBe(false);
    expect(isAbsoluteHttpsUrl(null)).toBe(false);
  });
});

describe('HealthLibraryService.setCoverImage', () => {
  let h: HealthLibraryHarness;

  beforeEach(() => {
    h = createHarness();
    h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT', coverImageKey: OLD_KEY }));
    h.post.updateMany.mockResolvedValue({ count: 1 });
    h.uploadFile.mockResolvedValue({ success: true, url: NEW_URL, key: NEW_KEY });
  });

  describe('input validation', () => {
    it.each([
      ['no file', null],
      ['an empty file', makeFile(Buffer.alloc(0))],
    ])('rejects %s with 400 before touching storage', async (_label, file) => {
      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, file, DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.uploadFile).not.toHaveBeenCalled();
    });

    it('enforces the 5 MB limit (exactly 5 MB is accepted)', async () => {
      const limit = 5 * 1024 * 1024;
      const atLimit = Buffer.concat([JPEG_BYTES, Buffer.alloc(limit - JPEG_BYTES.length)]);
      const overLimit = Buffer.concat([atLimit, Buffer.alloc(1)]);

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(overLimit), DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.uploadFile).not.toHaveBeenCalled();

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(atLimit), DOCTOR)
      ).resolves.toBeDefined();
    });

    it.each([
      ['a PDF claiming to be image/jpeg', PDF_BYTES, 'image/jpeg'],
      ['a GIF', GIF_BYTES, 'image/gif'],
      ['an SVG claiming to be image/png', Buffer.from('<svg onload="alert(1)"/>'), 'image/png'],
    ])('rejects %s because the bytes are not JPEG/PNG/WebP', async (_label, bytes, mimetype) => {
      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(bytes, mimetype), DOCTOR)
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(h.uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      ['JPEG', JPEG_BYTES, 'image/jpeg', 'jpg'],
      ['PNG', PNG_BYTES, 'image/png', 'png'],
      ['WebP', WEBP_BYTES, 'image/webp', 'webp'],
    ])(
      'accepts %s by magic bytes and uploads it with the detected type, not the client mimetype',
      async (_label, bytes, detectedMime, extension) => {
        await h.service.setCoverImage(
          POST_ID,
          CLINIC_ID,
          makeFile(bytes, 'application/octet-stream'),
          DOCTOR
        );

        const [buffer, fileName, assetType, contentType, isPublic] =
          h.uploadFile.mock.calls[0] ?? [];
        expect(buffer).toBe(bytes);
        expect(fileName).toMatch(new RegExp(`^${POST_ID}-\\d+\\.${extension}$`));
        expect(assetType).toBe('library-covers');
        expect(contentType).toBe(detectedMime);
        expect(isPublic).toBe(true);
      }
    );

    it('responds 404 for an unknown post before uploading anything', async () => {
      h.post.findFirst.mockResolvedValue(null);

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.uploadFile).not.toHaveBeenCalled();
    });
  });

  describe('storage failures', () => {
    it('responds 500 and writes nothing when storage reports failure', async () => {
      h.uploadFile.mockResolvedValue({ success: false, error: 'disk full' });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.deleteAsset).not.toHaveBeenCalled();
    });

    it('rejects the S3 local-disk fallback (relative URL, no key), deletes the stored file and never writes a keyless row', async () => {
      const localPath = '/app/storage/assets/library-covers/uuid-post-1-123.jpg';
      h.uploadFile.mockResolvedValue({
        success: true,
        url: '/storage/assets/library-covers/uuid-post-1-123.jpg',
        localPath,
      });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(h.deleteAsset).toHaveBeenCalledWith(localPath);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.post.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a non-https URL even when a key is present and deletes that object', async () => {
      h.uploadFile.mockResolvedValue({
        success: true,
        url: `http://cdn.example.com/${NEW_KEY}`,
        key: NEW_KEY,
      });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.deleteAsset).toHaveBeenCalledWith(NEW_KEY);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
    });

    it('rejects an https URL that has no object key (nothing deletable is known)', async () => {
      h.uploadFile.mockResolvedValue({ success: true, url: NEW_URL });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.executeHealthcareWrite).not.toHaveBeenCalled();
      expect(h.deleteAsset).not.toHaveBeenCalled();
    });

    it('falls back to the relative /storage URL for cleanup when no key or path is reported', async () => {
      h.uploadFile.mockResolvedValue({
        success: true,
        url: '/storage/assets/library-covers/x.jpg',
      });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.deleteAsset).toHaveBeenCalledWith('/storage/assets/library-covers/x.jpg');
    });

    it('still reports the original error when cleaning up the unusable upload fails too', async () => {
      h.uploadFile.mockResolvedValue({ success: true, url: '/storage/assets/x.jpg' });
      h.deleteAsset.mockRejectedValue(new Error('unlink failed'));

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('cover object delete failed'),
        'HealthLibraryService',
        expect.objectContaining({ error: 'unlink failed' })
      );
    });
  });

  describe('database failures', () => {
    it('deletes the just-uploaded object and rethrows when the DB update fails', async () => {
      const dbError = new Error('connection reset');
      h.post.updateMany.mockRejectedValue(dbError);

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBe(dbError);

      expect(h.deleteAsset).toHaveBeenCalledTimes(1);
      expect(h.deleteAsset).toHaveBeenCalledWith(NEW_KEY);
    });

    it('rethrows the DB error even if deleting the orphan also fails (and logs it)', async () => {
      const dbError = new Error('connection reset');
      h.post.updateMany.mockRejectedValue(dbError);
      h.deleteAsset.mockRejectedValue(new Error('storage offline'));

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBe(dbError);
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('cover object delete failed'),
        'HealthLibraryService',
        expect.objectContaining({ key: NEW_KEY, error: 'storage offline' })
      );
    });

    it('deletes the new object and responds 404 when the post vanished before the write', async () => {
      // Pre-check sees the post; the write matches nothing; the re-read finds no live row.
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT', coverImageKey: OLD_KEY }))
        .mockResolvedValueOnce(null);
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(h.deleteAsset).toHaveBeenCalledTimes(1);
      expect(h.deleteAsset).toHaveBeenCalledWith(NEW_KEY);
    });

    it('retries against the re-read key when the cover was swapped meanwhile, then removes exactly that key', async () => {
      const RIVAL_KEY = 'library-covers/uuid-rival.png';
      h.post.findFirst
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT', coverImageKey: OLD_KEY }))
        .mockResolvedValueOnce(makeRow({ status: 'DRAFT', coverImageKey: RIVAL_KEY }))
        .mockResolvedValue(makeRow({ status: 'DRAFT', coverImageKey: NEW_KEY }));
      h.post.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });

      await h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR);

      const wheres = h.post.updateMany.mock.calls.map(([args]) => args['where']);
      expect(wheres).toEqual([
        { id: POST_ID, clinicId: CLINIC_ID, deletedAt: null, coverImageKey: OLD_KEY },
        { id: POST_ID, clinicId: CLINIC_ID, deletedAt: null, coverImageKey: RIVAL_KEY },
      ]);
      // The rival object is what this call replaced; the stale OLD_KEY was never ours to remove.
      expect(h.deleteAsset).toHaveBeenCalledTimes(1);
      expect(h.deleteAsset).toHaveBeenCalledWith(RIVAL_KEY);
    });

    it('gives up with 409 after 3 lost attempts and deletes only the object this call stored', async () => {
      let rivalCount = 0;
      h.post.findFirst.mockImplementation(() => {
        rivalCount += 1;
        return Promise.resolve(
          makeRow({ status: 'DRAFT', coverImageKey: `library-covers/rival-${rivalCount}.png` })
        );
      });
      h.post.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).rejects.toBeInstanceOf(ConflictException);

      expect(h.post.updateMany).toHaveBeenCalledTimes(3);
      expect(h.deleteAsset).toHaveBeenCalledTimes(1);
      expect(h.deleteAsset).toHaveBeenCalledWith(NEW_KEY);
    });
  });

  describe('success', () => {
    it('stores url and key together with a scoped write and removes the replaced cover', async () => {
      const result = await h.service.setCoverImage(
        POST_ID,
        CLINIC_ID,
        makeFile(JPEG_BYTES),
        DOCTOR
      );

      expect(h.post.updateMany.mock.calls[0]?.[0]).toEqual({
        // Compare-and-set on the key that was read, so a concurrent swap is never clobbered.
        where: { id: POST_ID, clinicId: CLINIC_ID, deletedAt: null, coverImageKey: OLD_KEY },
        data: { coverImageUrl: NEW_URL, coverImageKey: NEW_KEY },
      });
      expect(h.deleteAsset).toHaveBeenCalledTimes(1);
      expect(h.deleteAsset).toHaveBeenCalledWith(OLD_KEY);
      expect(result.id).toBe(POST_ID);
      expect(h.auditOf()).toMatchObject({ operation: 'UPDATE', userId: 'author-1' });
    });

    it('does not delete anything when the post had no previous cover (CAS matches a null key)', async () => {
      h.post.findFirst.mockResolvedValue(makeRow({ status: 'DRAFT', coverImageKey: null }));

      await h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR);

      expect(h.post.updateMany.mock.calls[0]?.[0]).toMatchObject({
        where: { coverImageKey: null },
      });
      expect(h.deleteAsset).not.toHaveBeenCalled();
    });

    it('succeeds, and logs, when the replaced cover cannot be deleted', async () => {
      h.deleteAsset.mockResolvedValue(false);

      await expect(
        h.service.setCoverImage(POST_ID, CLINIC_ID, makeFile(JPEG_BYTES), DOCTOR)
      ).resolves.toBeDefined();
      expect(h.log).toHaveBeenCalledWith(
        expect.anything(),
        LogLevel.WARN,
        expect.stringContaining('cover object was not deleted'),
        'HealthLibraryService',
        expect.objectContaining({ key: OLD_KEY })
      );
    });
  });
});
