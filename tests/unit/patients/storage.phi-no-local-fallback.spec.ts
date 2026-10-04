/// <reference types="jest" />
/**
 * S3StorageService: PHI never falls back to the pod-local disk while S3 is configured,
 * a trailing slash on CDN_URL no longer breaks the stored URLs, an unparseable URL of
 * our own bucket is reported, and deleteFile never sends local references to S3.
 */

import * as path from 'path';
import {
  S3StorageService,
  PHI_STORAGE_FOLDERS,
  isPhiStorageFolder,
} from '@infrastructure/storage/s3-storage.service';

const sendMock = jest.fn();
const writeFileSyncMock = jest.fn();

jest.mock('fs', () => ({
  ...jest.requireActual<typeof import('fs')>('fs'),
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn(),
  writeFileSync: (...args: unknown[]): void => {
    writeFileSyncMock(...args);
  },
  unlinkSync: jest.fn(),
}));
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
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const BASE_CONFIG: Record<string, unknown> = {
  S3_ENABLED: true,
  S3_PROVIDER: 'contabo',
  S3_ENDPOINT: 'https://eu2.contabostorage.com',
  S3_REGION: 'eu-central-1',
  S3_BUCKET: 'healthcaredata',
  S3_ACCESS_KEY_ID: 'AKIA123',
  S3_SECRET_ACCESS_KEY: 'secret',
};

interface Created {
  service: S3StorageService;
  logging: { log: jest.Mock };
}

async function createService(overrides: Record<string, unknown> = {}): Promise<Created> {
  const values = { ...BASE_CONFIG, ...overrides };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new S3StorageService(configService as never, logging as never);
  await service.onModuleInit();
  return { service, logging };
}

function upload(service: S3StorageService, folder: string) {
  return service.uploadFile(Buffer.from('x'), 'file.pdf', folder, 'application/pdf', false);
}

function sentCommands(): string[] {
  return sendMock.mock.calls.map(call => (call[0] as object).constructor.name);
}

describe('PHI folders', () => {
  it('are documents, medical-records, invoices and prescriptions', () => {
    expect([...PHI_STORAGE_FOLDERS]).toEqual([
      'documents',
      'medical-records',
      'invoices',
      'prescriptions',
    ]);
  });

  it('isPhiStorageFolder looks at the top-level folder only', () => {
    expect(isPhiStorageFolder('documents')).toBe(true);
    expect(isPhiStorageFolder('medical-records/legacy')).toBe(true);
    expect(isPhiStorageFolder('qr-codes')).toBe(false);
    expect(isPhiStorageFolder('library-covers')).toBe(false);
    expect(isPhiStorageFolder('images')).toBe(false);
    expect(isPhiStorageFolder('')).toBe(false);
  });
});

describe('S3StorageService.uploadFile never stores PHI locally while S3 is configured', () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({});
    writeFileSyncMock.mockReset();
  });

  it.each(PHI_STORAGE_FOLDERS)(
    'a failed PutObject for %s/ is reported as success:false with no local copy and no URL',
    async folder => {
      const { service, logging } = await createService();
      sendMock.mockReset().mockRejectedValue(new Error('S3 unreachable'));

      const result = await upload(service, folder);

      expect(result.success).toBe(false);
      expect(result.url).toBeUndefined();
      expect(result.localPath).toBeUndefined();
      expect(result.key).toBeUndefined();
      expect(writeFileSyncMock).not.toHaveBeenCalled();
      // the refusal is logged at ERROR, without the (possibly sensitive) file name payload
      expect(logging.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('PHI upload refused'),
        'S3StorageService.uploadFile',
        expect.objectContaining({ folder })
      );
    }
  );

  it('a nested PHI folder path is protected too', async () => {
    const { service } = await createService();
    sendMock.mockReset().mockRejectedValue(new Error('S3 unreachable'));

    const result = await upload(service, 'documents/clinic-1/patient-1');

    expect(result.success).toBe(false);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it('when S3 is configured but its client could not be initialised, PHI is still refused', async () => {
    sendMock.mockReset().mockRejectedValue(new Error('endpoint unreachable'));
    const { service } = await createService(); // onModuleInit fails -> S3 disabled at runtime
    expect(service.isS3Enabled()).toBe(false);

    const result = await upload(service, 'documents');

    expect(result.success).toBe(false);
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(sentCommands().filter(name => name === 'PutObjectCommand')).toHaveLength(0);
  });

  it('non-PHI assets (QR codes, covers) keep the local fallback', async () => {
    const { service } = await createService();
    sendMock.mockReset().mockRejectedValue(new Error('S3 unreachable'));

    for (const folder of ['qr-codes', 'library-covers']) {
      writeFileSyncMock.mockClear();
      const result = await service.uploadFile(Buffer.from('x'), 'a.png', folder, 'image/png', true);

      expect(result.success).toBe(true);
      expect(result.url).toBe(`/storage/assets/${folder}/uuid-1-a.png`);
      expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    }
  });

  it('when S3 is NOT configured the local store is the configured mode and PHI is stored there', async () => {
    const { service } = await createService({ S3_ENABLED: false });

    const result = await upload(service, 'documents');

    expect(result.success).toBe(true);
    expect(result.url).toBe('/storage/assets/documents/uuid-1-file.pdf');
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
  });

  it('a successful PutObject for PHI is unchanged: private key, no ACL, no local write', async () => {
    const { service } = await createService();
    sendMock.mockClear();

    const result = await upload(service, 'documents');

    expect(result).toMatchObject({ success: true, key: 'documents/uuid-1-file.pdf' });
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    const put = sendMock.mock.calls
      .map(call => call[0] as { input: Record<string, unknown> })
      .find(command => command.input['Key'] === 'documents/uuid-1-file.pdf');
    expect(put?.input).not.toHaveProperty('ACL');
  });
});

describe('S3StorageService CDN_URL with a trailing slash', () => {
  beforeEach(() => sendMock.mockReset().mockResolvedValue({}));

  it('does not produce a double slash and the stored URL is recognised as ours', async () => {
    const { service } = await createService({ CDN_URL: 'https://cdn.example.com/' });

    const result = await upload(service, 'documents');

    expect(result.url).toBe('https://cdn.example.com/documents/uuid-1-file.pdf');
    expect(service.resolveOwnedObjectKey(result.url ?? '', ['documents'])).toBe(
      'documents/uuid-1-file.pdf'
    );
  });

  it('several trailing slashes are trimmed as well; a CDN_URL without slash is unchanged', async () => {
    const many = await createService({ CDN_URL: 'https://cdn.example.com///' });
    expect((await upload(many.service, 'documents')).url).toBe(
      'https://cdn.example.com/documents/uuid-1-file.pdf'
    );

    const plain = await createService({ CDN_URL: 'https://cdn.example.com' });
    expect((await upload(plain.service, 'documents')).url).toBe(
      'https://cdn.example.com/documents/uuid-1-file.pdf'
    );
  });
});

describe('S3StorageService.resolveOwnedObjectKey warns about unsignable URLs of our own bucket', () => {
  const FOLDERS = ['documents', 'medical-records'];
  const OWN = 'https://eu2.contabostorage.com/AKIA123:healthcaredata';

  it.each([
    ['a folder that is not signed', `${OWN}/invoices/inv-1.pdf`],
    ['a traversal attempt', `${OWN}/documents/../invoices/x.pdf`],
    ['an encoded separator', `${OWN}/documents/a%2Fb.pdf`],
    ['a double slash', `${OWN}/documents//x.pdf`],
  ])('%s -> null, logged as WARN without the URL', async (_label, url) => {
    const { service, logging } = await createService();
    logging.log.mockClear();

    expect(service.resolveOwnedObjectKey(url, FOLDERS)).toBeNull();

    const warnings = logging.log.mock.calls.filter(call =>
      String(call[2]).includes('not a signable object key')
    );
    expect(warnings).toHaveLength(1);
    const logged = JSON.stringify(warnings[0]);
    expect(logged).not.toContain('contabostorage');
    expect(logged).not.toContain('inv-1');
    expect(logged).not.toContain('AKIA123');
  });

  it('a valid key, a foreign URL and a local path log nothing', async () => {
    const { service, logging } = await createService();
    logging.log.mockClear();

    expect(service.resolveOwnedObjectKey(`${OWN}/documents/u-doc.pdf`, FOLDERS)).toBe(
      'documents/u-doc.pdf'
    );
    expect(service.resolveOwnedObjectKey('https://evil.example.com/documents/x.pdf', FOLDERS)).toBe(
      null
    );
    expect(service.resolveOwnedObjectKey('/storage/assets/documents/x.pdf', FOLDERS)).toBe(null);
    expect(service.resolveOwnedObjectKey('', FOLDERS)).toBe(null);

    expect(logging.log).not.toHaveBeenCalled();
  });
});

describe('S3StorageService.deleteFile', () => {
  beforeEach(() => sendMock.mockReset().mockResolvedValue({}));

  it('sends DeleteObject for a relative object key', async () => {
    const { service } = await createService();
    sendMock.mockClear();

    await expect(service.deleteFile('documents/uuid-1-file.pdf')).resolves.toBe(true);

    expect(sentCommands()).toEqual(['DeleteObjectCommand']);
  });

  it('never sends an absolute disk path to S3 (a bogus key that "succeeds" and leaves the file)', async () => {
    const { service } = await createService();
    sendMock.mockClear();
    const absolute = path.join(process.cwd(), 'storage', 'assets', 'documents', 'f.pdf');

    await service.deleteFile(absolute);

    expect(sentCommands()).not.toContain('DeleteObjectCommand');
  });

  it('never sends a relative /storage/... reference to S3', async () => {
    const { service } = await createService();
    sendMock.mockClear();

    await service.deleteFile('/storage/assets/documents/f.pdf');

    expect(sentCommands()).not.toContain('DeleteObjectCommand');
  });
});
