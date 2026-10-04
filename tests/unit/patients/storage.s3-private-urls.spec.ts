/// <reference types="jest" />
/**
 * S3StorageService: private uploads carry no public ACL, presigned download URLs
 * are short-lived, and only objects of OUR bucket are recognised as signable.
 */

import { S3StorageService } from '@infrastructure/storage/s3-storage.service';

const sendMock = jest.fn();
const getSignedUrlMock = jest.fn();

jest.mock('uuid', () => ({ v4: () => 'uuid-1' }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  return {
    S3Client: class S3Client {
      send = (command: unknown) => sendMock(command) as Promise<unknown>;
    },
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    HeadObjectCommand: class HeadObjectCommand extends Command {},
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args) as Promise<string>,
}));

const BASE_CONFIG: Record<string, unknown> = {
  S3_ENABLED: true,
  S3_PROVIDER: 'contabo',
  S3_ENDPOINT: 'https://eu2.contabostorage.com',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'healthcaredata',
  S3_ACCESS_KEY_ID: 'AKIA123',
  S3_SECRET_ACCESS_KEY: 'secret',
};

async function createService(overrides: Record<string, unknown> = {}): Promise<S3StorageService> {
  const values = { ...BASE_CONFIG, ...overrides };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new S3StorageService(configService as never, loggingService as never);
  await service.onModuleInit();
  return service;
}

function sentInputs(): Array<Record<string, unknown>> {
  return sendMock.mock.calls.map(call => (call[0] as { input: Record<string, unknown> }).input);
}

describe('S3StorageService private uploads', () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    getSignedUrlMock.mockReset().mockResolvedValue('https://signed.example/obj?sig=1');
  });

  it('stores a private object without any public ACL', async () => {
    const service = await createService();
    sendMock.mockClear();

    const result = await service.uploadFile(
      Buffer.from('x'),
      'doc-1.pdf',
      'documents',
      'application/pdf',
      false
    );

    const put = sentInputs().find(input => input['Key'] === 'documents/uuid-1-doc-1.pdf');
    expect(put).toBeDefined();
    expect(put).not.toHaveProperty('ACL');
    expect(result).toMatchObject({ success: true, key: 'documents/uuid-1-doc-1.pdf' });
  });

  it('still sets public-read for assets that are meant to be public', async () => {
    const service = await createService();
    sendMock.mockClear();

    await service.uploadFile(Buffer.from('x'), 'qr.png', 'qr-codes', 'image/png', true);

    expect(sentInputs().find(input => input['Key'] === 'qr-codes/uuid-1-qr.png')).toMatchObject({
      ACL: 'public-read',
    });
  });

  it('records a private object without a CDN as an s3:// placeholder that is still recognised as ours', async () => {
    const service = await createService({
      CDN_URL: '',
      S3_ACCESS_KEY_ID: '',
      AWS_ACCESS_KEY_ID: '',
    });

    const result = await service.uploadFile(
      Buffer.from('x'),
      'doc-1.pdf',
      'documents',
      'application/pdf',
      false
    );

    expect(result.url).toBe('s3://healthcaredata/documents/uuid-1-doc-1.pdf');
    expect(service.resolveOwnedObjectKey(result.url ?? '', ['documents'])).toBe(
      'documents/uuid-1-doc-1.pdf'
    );
  });
});

describe('S3StorageService.getSignedDownloadUrl', () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    getSignedUrlMock.mockReset().mockResolvedValue('https://signed.example/obj?sig=1');
  });

  it('presigns a GET for the key with a 15 minute default lifetime', async () => {
    const service = await createService();

    const url = await service.getSignedDownloadUrl('documents/uuid-1-doc-1.pdf');

    expect(url).toBe('https://signed.example/obj?sig=1');
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, options] = getSignedUrlMock.mock.calls[0] as [
      unknown,
      { input: Record<string, unknown> },
      { expiresIn: number },
    ];
    expect(command.input).toEqual({ Bucket: 'healthcaredata', Key: 'documents/uuid-1-doc-1.pdf' });
    expect(options).toEqual({ expiresIn: 900 });
  });

  it('honours a custom lifetime and clamps it to what S3 accepts', async () => {
    const service = await createService();

    await service.getSignedDownloadUrl('documents/a.pdf', 60);
    await service.getSignedDownloadUrl('documents/a.pdf', 99 * 24 * 3600);

    const lifetimes = getSignedUrlMock.mock.calls.map(
      call => (call[2] as { expiresIn: number }).expiresIn
    );
    expect(lifetimes).toEqual([60, 7 * 24 * 3600]);
  });

  it('throws when S3 is disabled (callers fall back to the stored URL)', async () => {
    const service = await createService({ S3_ENABLED: false });
    await expect(service.getSignedDownloadUrl('documents/a.pdf')).rejects.toThrow(
      'S3 client not initialized'
    );
  });
});

describe('S3StorageService.resolveOwnedObjectKey', () => {
  it('recognises only objects of the configured bucket under the allowed folders', async () => {
    const service = await createService();
    const folders = ['documents', 'medical-records'];

    expect(
      service.resolveOwnedObjectKey(
        'https://eu2.contabostorage.com/AKIA123:healthcaredata/documents/u-doc.pdf',
        folders
      )
    ).toBe('documents/u-doc.pdf');
    expect(
      service.resolveOwnedObjectKey('https://evil.example.com/documents/u-doc.pdf', folders)
    ).toBeNull();
    expect(
      service.resolveOwnedObjectKey('s3://healthcaredata/invoices/inv.pdf', folders)
    ).toBeNull();
    expect(
      service.resolveOwnedObjectKey('/storage/assets/documents/u-doc.pdf', folders)
    ).toBeNull();
  });
});
