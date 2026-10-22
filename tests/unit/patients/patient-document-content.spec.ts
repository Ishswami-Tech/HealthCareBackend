/**
 * Unit tests for the stored-file -> streamable source resolution behind
 * GET patients/:id/documents/:documentId/content.
 */

import { describe, expect, it, jest } from '@jest/globals';
import {
  patientDocumentContentPath,
  resolveDocumentContentSource,
} from '@services/patients/patient-document.util';

jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));

const PATIENT_ID = 'pat-123';
const USER_ID = 'usr-456';
const noS3 = (): string | null => null;

describe('resolveDocumentContentSource', () => {
  it('serves a local-disk document that belongs to the patient', () => {
    const source = resolveDocumentContentSource(
      `/storage/assets/documents/uuid-doc-${PATIENT_ID}-1700000000000.pdf`,
      [PATIENT_ID, USER_ID],
      noS3
    );
    expect(source).toEqual({
      provider: 'local',
      storageKey: `/storage/assets/documents/uuid-doc-${PATIENT_ID}-1700000000000.pdf`,
    });
  });

  it('serves a legacy medical-records file bound by the user id', () => {
    const source = resolveDocumentContentSource(
      `/storage/assets/medical-records/x-medical-record/${USER_ID}/rec-1.pdf`,
      [PATIENT_ID, USER_ID],
      noS3
    );
    expect(source?.provider).toBe('local');
  });

  it('refuses a local file of another patient', () => {
    expect(
      resolveDocumentContentSource(
        '/storage/assets/documents/uuid-doc-pat-999-1.pdf',
        [PATIENT_ID, USER_ID],
        noS3
      )
    ).toBeNull();
  });

  it('refuses traversal and other folders', () => {
    expect(
      resolveDocumentContentSource(
        `/storage/assets/documents/../qr/${PATIENT_ID}.png`,
        [PATIENT_ID],
        noS3
      )
    ).toBeNull();
    expect(
      resolveDocumentContentSource(`/storage/assets/qr-codes/${PATIENT_ID}.png`, [PATIENT_ID], noS3)
    ).toBeNull();
  });

  it('serves an own-bucket S3 object bound to the patient', () => {
    const resolveOwnedKey = (url: string): string | null =>
      url.startsWith('https://bucket.example.com/')
        ? url.slice('https://bucket.example.com/'.length)
        : null;
    expect(
      resolveDocumentContentSource(
        `https://bucket.example.com/documents/u-doc-${PATIENT_ID}-1.pdf`,
        [PATIENT_ID],
        resolveOwnedKey
      )
    ).toEqual({ provider: 's3', key: `documents/u-doc-${PATIENT_ID}-1.pdf` });
  });

  it('refuses a foreign host, a foreign object and an empty binding', () => {
    expect(
      resolveDocumentContentSource(
        `https://evil.example.com/documents/${PATIENT_ID}.pdf`,
        [PATIENT_ID],
        noS3
      )
    ).toBeNull();
    expect(
      resolveDocumentContentSource(
        'https://bucket.example.com/documents/u-doc-pat-999-1.pdf',
        [PATIENT_ID],
        () => 'documents/u-doc-pat-999-1.pdf'
      )
    ).toBeNull();
    expect(
      resolveDocumentContentSource(
        `/storage/assets/documents/doc-${PATIENT_ID}.pdf`,
        [null, ''],
        noS3
      )
    ).toBeNull();
    expect(resolveDocumentContentSource(null, [PATIENT_ID], noS3)).toBeNull();
  });
});

describe('patientDocumentContentPath', () => {
  it('builds the authenticated content route, encoding ids', () => {
    expect(patientDocumentContentPath('p 1', 'd/2')).toBe(
      '/patients/p%201/documents/d%2F2/content'
    );
  });
});
