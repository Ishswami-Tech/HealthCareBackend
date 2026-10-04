/// <reference types="jest" />
/**
 * StaticAssetService.resolveSignedUrl: private documents / medical-record files
 * are handed to clients as short-lived presigned URLs, with a safe fallback to
 * the stored URL in every case where signing must not (or cannot) happen.
 */

import { StaticAssetService } from '@infrastructure/storage/static-asset.service';

jest.mock('uuid', () => ({ v4: () => 'uuid-1' }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class S3Client {},
  PutObjectCommand: class PutObjectCommand {},
  GetObjectCommand: class GetObjectCommand {},
  DeleteObjectCommand: class DeleteObjectCommand {},
  HeadObjectCommand: class HeadObjectCommand {},
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const SIGNED = 'https://signed.example/documents/u1-doc.pdf?X-Amz-Signature=secret';
const STORED = 'https://cdn.example.com/documents/u1-doc.pdf';

function createHarness(
  options: { s3Enabled?: boolean; key?: string | null; signError?: Error } = {}
) {
  const s3 = {
    isS3Enabled: jest.fn().mockReturnValue(options.s3Enabled ?? true),
    resolveOwnedObjectKey: jest
      .fn()
      .mockReturnValue(options.key === undefined ? 'documents/u1-doc.pdf' : options.key),
    getSignedDownloadUrl: options.signError
      ? jest.fn().mockRejectedValue(options.signError)
      : jest.fn().mockResolvedValue(SIGNED),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new StaticAssetService(s3 as never, logging as never);
  return { service, s3, logging };
}

describe('StaticAssetService.resolveSignedUrl', () => {
  it('presigns an own-bucket document for 15 minutes by default', async () => {
    const h = createHarness();

    await expect(h.service.resolveSignedUrl(STORED)).resolves.toBe(SIGNED);

    expect(h.s3.resolveOwnedObjectKey).toHaveBeenCalledWith(STORED, [
      'documents',
      'medical-records',
    ]);
    expect(h.s3.getSignedDownloadUrl).toHaveBeenCalledWith('documents/u1-doc.pdf', 900);
  });

  it('honours an explicit lifetime', async () => {
    const h = createHarness();
    await h.service.resolveSignedUrl(STORED, 120);
    expect(h.s3.getSignedDownloadUrl).toHaveBeenCalledWith('documents/u1-doc.pdf', 120);
  });

  it('returns local-disk fallback URLs unchanged (S3 off)', async () => {
    const h = createHarness({ s3Enabled: false });
    const local = '/storage/assets/documents/u1-doc.pdf';

    await expect(h.service.resolveSignedUrl(local)).resolves.toBe(local);
    expect(h.s3.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns a local-disk URL unchanged even when S3 is on (not one of our bucket objects)', async () => {
    const h = createHarness({ key: null });
    const local = '/storage/assets/medical-records/u1-doc.pdf';

    await expect(h.service.resolveSignedUrl(local)).resolves.toBe(local);
    expect(h.s3.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('never presigns a URL that is not an own-bucket object under a managed folder', async () => {
    const h = createHarness({ key: null });
    const foreign = 'https://evil.example.com/documents/u1-doc.pdf';

    await expect(h.service.resolveSignedUrl(foreign)).resolves.toBe(foreign);
    expect(h.s3.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('returns an empty value as is', async () => {
    const h = createHarness();
    await expect(h.service.resolveSignedUrl('')).resolves.toBe('');
    expect(h.s3.resolveOwnedObjectKey).not.toHaveBeenCalled();
  });

  it('falls back to the stored URL and logs a warning WITHOUT the url when presigning fails', async () => {
    const h = createHarness({ signError: new Error('clock skew') });

    await expect(h.service.resolveSignedUrl(STORED)).resolves.toBe(STORED);

    expect(h.logging.log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(h.logging.log.mock.calls[0]);
    expect(logged).toContain('clock skew');
    expect(logged).not.toContain(STORED);
    expect(logged).not.toContain('X-Amz-Signature');
    expect(logged).not.toContain('u1-doc.pdf');
  });

  it('does not throw even when the warning cannot be logged', async () => {
    const h = createHarness({ signError: new Error('boom') });
    h.logging.log.mockRejectedValue(new Error('log sink down'));

    await expect(h.service.resolveSignedUrl(STORED)).resolves.toBe(STORED);
  });
});

describe('StaticAssetService.resolveSignedUrl bound to the row (boundTo)', () => {
  const KEY = 'documents/0f8fad5b-doc-patient-1-1700.pdf';

  it('presigns when the key carries one of the row ids', async () => {
    const h = createHarness({ key: KEY });

    await expect(
      h.service.resolveSignedUrl(STORED, undefined, { boundTo: ['patient-1', 'user-1'] })
    ).resolves.toBe(SIGNED);
    expect(h.s3.getSignedDownloadUrl).toHaveBeenCalledWith(KEY, 900);
  });

  it('presigns when only the second candidate id (e.g. a legacy User.id key) matches', async () => {
    const h = createHarness({ key: 'documents/uuid-doc-user-1-1700.pdf' });

    await expect(
      h.service.resolveSignedUrl(STORED, undefined, { boundTo: ['patient-1', 'user-1'] })
    ).resolves.toBe(SIGNED);
  });

  it('never presigns an object that belongs to another row: the stored value comes back and a WARN is logged without the URL', async () => {
    const h = createHarness({ key: 'documents/uuid-doc-patient-VICTIM-1700.pdf' });

    await expect(
      h.service.resolveSignedUrl(STORED, undefined, { boundTo: ['patient-1', 'user-1'] })
    ).resolves.toBe(STORED);

    expect(h.s3.getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(h.logging.log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(h.logging.log.mock.calls[0]);
    expect(logged).toContain('does not belong to its row');
    expect(logged).not.toContain(STORED);
    expect(logged).not.toContain('VICTIM');
  });

  it('an empty or blank candidate list never matches (fail closed)', async () => {
    const h = createHarness({ key: KEY });

    await expect(h.service.resolveSignedUrl(STORED, undefined, { boundTo: [] })).resolves.toBe(
      STORED
    );
    await expect(
      h.service.resolveSignedUrl(STORED, undefined, { boundTo: ['', undefined, null] })
    ).resolves.toBe(STORED);
    expect(h.s3.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('without boundTo the previous behaviour is unchanged', async () => {
    const h = createHarness({ key: KEY });

    await expect(h.service.resolveSignedUrl(STORED)).resolves.toBe(SIGNED);
  });

  it('a binding mismatch never throws, even when the warning cannot be logged', async () => {
    const h = createHarness({ key: 'documents/uuid-doc-other-1.pdf' });
    h.logging.log.mockRejectedValue(new Error('log sink down'));

    await expect(
      h.service.resolveSignedUrl(STORED, undefined, { boundTo: ['patient-1'] })
    ).resolves.toBe(STORED);
  });

  it('local-disk URLs and S3-off are still returned untouched whatever the binding', async () => {
    const h = createHarness({ s3Enabled: false });
    const local = '/storage/assets/documents/u1-doc.pdf';

    await expect(
      h.service.resolveSignedUrl(local, undefined, { boundTo: ['patient-1'] })
    ).resolves.toBe(local);
  });
});

describe('StaticAssetService.getSignedDownloadUrl', () => {
  it('delegates to the storage service with a 15 minute default', async () => {
    const h = createHarness();

    await expect(h.service.getSignedDownloadUrl('documents/a.pdf')).resolves.toBe(SIGNED);
    expect(h.s3.getSignedDownloadUrl).toHaveBeenCalledWith('documents/a.pdf', 900);
  });
});
