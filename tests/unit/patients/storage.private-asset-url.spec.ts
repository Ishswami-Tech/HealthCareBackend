/**
 * Pure helpers behind presigned-URL serving of private documents: which stored
 * URLs count as "ours" (and may be presigned) and which never do.
 */

import {
  PRIVATE_ASSET_URL_TTL_SECONDS,
  buildOwnedUrlPrefixes,
  clampPresignTtl,
  extractOwnedObjectKey,
} from '@infrastructure/storage/s3-storage.service';

// The helpers live next to S3StorageService; stub what that module pulls in.
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

const FOLDERS = ['documents', 'medical-records'];

const CONTABO = {
  bucket: 'healthcaredata',
  region: 'eu-central-1',
  endpoint: 'https://eu2.contabostorage.com/',
  accessKeyId: 'AKIA123',
  cdnUrl: 'https://eu2.contabostorage.com/AKIA123:healthcaredata',
};

const AWS = { bucket: 'hc-bucket', region: 'ap-south-1' };

function keyFor(url: string | null | undefined, config = CONTABO): string | null {
  return extractOwnedObjectKey(url, buildOwnedUrlPrefixes(config), FOLDERS);
}

describe('PRIVATE_ASSET_URL_TTL_SECONDS', () => {
  it('is 15 minutes', () => {
    expect(PRIVATE_ASSET_URL_TTL_SECONDS).toBe(900);
  });
});

describe('clampPresignTtl', () => {
  it('keeps sane values, floors fractions and clamps to 1 s .. 7 days', () => {
    expect(clampPresignTtl(900)).toBe(900);
    expect(clampPresignTtl(59.9)).toBe(59);
    expect(clampPresignTtl(0)).toBe(1);
    expect(clampPresignTtl(-5)).toBe(1);
    expect(clampPresignTtl(10 * 24 * 3600)).toBe(7 * 24 * 3600);
  });

  it('falls back to the default for NaN / Infinity', () => {
    expect(clampPresignTtl(Number.NaN)).toBe(PRIVATE_ASSET_URL_TTL_SECONDS);
    expect(clampPresignTtl(Number.POSITIVE_INFINITY)).toBe(PRIVATE_ASSET_URL_TTL_SECONDS);
  });
});

describe('buildOwnedUrlPrefixes', () => {
  it('has no prefix at all without a bucket', () => {
    expect(buildOwnedUrlPrefixes({ ...CONTABO, bucket: '' })).toEqual([]);
  });

  it('covers placeholder, CDN, endpoint (access-key and path style) and AWS virtual-hosted URLs', () => {
    expect(buildOwnedUrlPrefixes(CONTABO)).toEqual([
      's3://healthcaredata/',
      'https://eu2.contabostorage.com/AKIA123:healthcaredata/',
      'https://eu2.contabostorage.com/healthcaredata/',
      'https://healthcaredata.s3.eu-central-1.amazonaws.com/',
    ]);
    expect(buildOwnedUrlPrefixes(AWS)).toEqual([
      's3://hc-bucket/',
      'https://hc-bucket.s3.ap-south-1.amazonaws.com/',
    ]);
  });
});

describe('extractOwnedObjectKey', () => {
  it.each([
    [
      's3 placeholder',
      's3://healthcaredata/documents/u1-doc-p1-1.pdf',
      'documents/u1-doc-p1-1.pdf',
    ],
    [
      'CDN / Contabo URL',
      'https://eu2.contabostorage.com/AKIA123:healthcaredata/documents/u1-doc-p1-1.pdf',
      'documents/u1-doc-p1-1.pdf',
    ],
    [
      'path-style endpoint URL',
      'https://eu2.contabostorage.com/healthcaredata/medical-records/u1-doc-r1-9.png',
      'medical-records/u1-doc-r1-9.png',
    ],
    [
      'AWS virtual-hosted URL',
      'https://healthcaredata.s3.eu-central-1.amazonaws.com/documents/u1-doc-p1-1.pdf',
      'documents/u1-doc-p1-1.pdf',
    ],
  ])('derives the key from a %s', (_label, url, expected) => {
    expect(keyFor(url)).toBe(expected);
  });

  it('keeps legacy nested medical-record keys intact', () => {
    expect(
      keyFor('s3://healthcaredata/medical-records/u1-medical-record/user-1/rec-1-17.pdf')
    ).toBe('medical-records/u1-medical-record/user-1/rec-1-17.pdf');
  });

  it('matches scheme and host case-insensitively but returns the stored key casing', () => {
    expect(keyFor('HTTPS://EU2.contabostorage.com/healthcaredata/documents/AbC-doc.pdf')).toBe(
      'documents/AbC-doc.pdf'
    );
  });

  it('ignores a query string or fragment on the stored URL', () => {
    expect(keyFor('s3://healthcaredata/documents/u1-doc.pdf?X-Amz-Signature=abc#frag')).toBe(
      'documents/u1-doc.pdf'
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['relative local path', '/storage/assets/documents/u1-doc.pdf'],
    ['foreign host', 'https://evil.example.com/healthcaredata/documents/u1-doc.pdf'],
    ['other bucket', 's3://other-bucket/documents/u1-doc.pdf'],
    ['bucket name as a path prefix of a foreign host', 'https://evil.example.com/documents/x.pdf'],
    [
      'host that merely starts with the CDN host',
      'https://eu2.contabostorage.com.evil.io/x/documents/a.pdf',
    ],
    ['non-managed folder', 's3://healthcaredata/invoices/u1-invoice.pdf'],
    ['folder prefix only', 's3://healthcaredata/documents/'],
    ['bare folder name without a file', 's3://healthcaredata/documents'],
    ['key outside any folder', 's3://healthcaredata/secret.pdf'],
    ['parent traversal', 's3://healthcaredata/documents/../invoices/a.pdf'],
    ['dot segment', 's3://healthcaredata/documents/./a.pdf'],
    ['empty segment', 's3://healthcaredata/documents//a.pdf'],
    ['encoded traversal', 's3://healthcaredata/documents/%2e%2e/a.pdf'],
    ['backslash', 's3://healthcaredata/documents\\a.pdf'],
    ['control character', 's3://healthcaredata/documents/a\u0000.pdf'],
  ])('returns null for %s', (_label, url) => {
    expect(keyFor(url as string | null | undefined)).toBeNull();
  });

  it('returns null for everything when no bucket is configured', () => {
    expect(keyFor('s3://healthcaredata/documents/a.pdf', { ...CONTABO, bucket: '' })).toBeNull();
  });
});
