/**
 * Unit tests for the patient document upload validation and storage-key helpers.
 */

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  PATIENT_DOCUMENT_MAX_BYTES,
  PHI_FILE_FOLDERS,
  buildDocumentStorageName,
  extractDocumentStorageRef,
  extractStoredFileRef,
  sanitizeDocumentTitle,
  validateDocumentFile,
  validatePatientDocumentUpload,
} from '@services/patients/patient-document.util';

jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(32, 0),
]);
const HEIC = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.alloc(32, 0),
]);

function file(buffer: Buffer, mimetype: string, originalname = 'report.pdf') {
  return { buffer, mimetype, originalname };
}

describe('validatePatientDocumentUpload', () => {
  it.each([
    ['application/pdf', PDF, 'pdf'],
    ['image/png', PNG, 'png'],
    ['image/jpeg', JPEG, 'jpg'],
    ['image/webp', WEBP, 'webp'],
    ['image/heic', HEIC, 'heic'],
  ])('accepts %s', (mime, buffer, extension) => {
    const result = validatePatientDocumentUpload(file(buffer, mime));

    expect(result.mimeType).toBe(mime);
    expect(result.extension).toBe(extension);
    expect(result.size).toBe(buffer.length);
  });

  it('rejects an empty file with 400', () => {
    expect(() => validatePatientDocumentUpload(file(Buffer.alloc(0), 'application/pdf'))).toThrow(
      BadRequestException
    );
  });

  it('rejects a file larger than 10 MB with 413', () => {
    const tooBig = Buffer.concat([PDF, Buffer.alloc(PATIENT_DOCUMENT_MAX_BYTES, 0x20)]);
    expect(() => validatePatientDocumentUpload(file(tooBig, 'application/pdf'))).toThrow(
      PayloadTooLargeException
    );
  });

  it('accepts a file of exactly 10 MB', () => {
    const exact = Buffer.concat([PDF, Buffer.alloc(PATIENT_DOCUMENT_MAX_BYTES - PDF.length, 0x20)]);
    expect(exact.length).toBe(PATIENT_DOCUMENT_MAX_BYTES);
    expect(validatePatientDocumentUpload(file(exact, 'application/pdf')).size).toBe(exact.length);
  });

  it.each(['text/html', 'image/svg+xml', 'application/zip', 'video/mp4', 'audio/mpeg'])(
    'rejects declared type %s',
    mime => {
      expect(() => validatePatientDocumentUpload(file(PDF, mime))).toThrow(BadRequestException);
    }
  );

  it('rejects HTML disguised as an allowed type (the file signature decides)', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    expect(() => validatePatientDocumentUpload(file(html, 'image/png'))).toThrow(
      BadRequestException
    );
  });

  it('rejects an audio/video container declared as an image', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypmp42'),
      Buffer.alloc(32),
    ]);
    expect(() => validatePatientDocumentUpload(file(mp4, 'image/png'))).toThrow(
      BadRequestException
    );
  });

  it('trusts the signature when the client only sends a generic type (mobile fallback)', () => {
    const result = validatePatientDocumentUpload(file(PDF, 'application/octet-stream'));
    expect(result.mimeType).toBe('application/pdf');
  });

  it('normalises image/jpg and strips MIME parameters', () => {
    expect(validatePatientDocumentUpload(file(JPEG, 'image/jpg')).mimeType).toBe('image/jpeg');
    expect(validatePatientDocumentUpload(file(PNG, 'image/png; charset=binary')).mimeType).toBe(
      'image/png'
    );
  });

  describe('category', () => {
    it('defaults to OTHER', () => {
      expect(validatePatientDocumentUpload(file(PDF, 'application/pdf')).category).toBe('OTHER');
    });

    it.each(['LAB_REPORT', 'IMAGING', 'PRESCRIPTION', 'INSURANCE', 'ID_PROOF', 'OTHER'])(
      'accepts the mobile value %s',
      category => {
        expect(
          validatePatientDocumentUpload(file(PDF, 'application/pdf'), { category }).category
        ).toBe(category);
      }
    );

    it('trims and normalises case/spacing', () => {
      const result = validatePatientDocumentUpload(file(PDF, 'application/pdf'), {
        category: '  lab report ',
      });
      expect(result.category).toBe('LAB_REPORT');
    });

    it.each([
      ['LAB_TEST', 'LAB_REPORT'],
      ['lab-test', 'LAB_REPORT'],
      ['DIAGNOSIS_REPORT', 'LAB_REPORT'],
      ['XRAY', 'IMAGING'],
      ['x ray', 'IMAGING'],
      ['MRI', 'IMAGING'],
      ['RX', 'PRESCRIPTION'],
      ['insurance card', 'INSURANCE'],
      ['ID_CARD', 'ID_PROOF'],
    ])('maps the web alias %s to %s (B1)', (alias, canonical) => {
      expect(
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), { category: alias }).category
      ).toBe(canonical);
    });

    it('rejects unknown and over-long categories with 400', () => {
      expect(() =>
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), { category: 'SECRET_STUFF' })
      ).toThrow(BadRequestException);
      expect(() =>
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), { category: 'A'.repeat(51) })
      ).toThrow(BadRequestException);
    });
  });

  describe('description', () => {
    it('is trimmed and optional', () => {
      expect(
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), { description: '  note  ' })
          .description
      ).toBe('note');
      expect(
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), { description: '   ' })
          .description
      ).toBeUndefined();
    });

    it('allows 500 characters and rejects 501 with 400', () => {
      expect(
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), {
          description: 'x'.repeat(500),
        }).description
      ).toHaveLength(500);
      expect(() =>
        validatePatientDocumentUpload(file(PDF, 'application/pdf'), {
          description: 'x'.repeat(501),
        })
      ).toThrow(BadRequestException);
    });
  });

  it('sanitises the file name used as the title', () => {
    const result = validatePatientDocumentUpload(
      file(PDF, 'application/pdf', '../../etc/passwd\u0000<script>.pdf')
    );
    expect(result.title).toBe('passwdscript.pdf');
  });
});

describe('validateDocumentFile (shared with the staff EHR upload)', () => {
  it('returns the canonical type, extension, size and a sanitised title', () => {
    expect(
      validateDocumentFile(file(PDF, 'application/octet-stream', '../x/Lab Result.pdf'))
    ).toEqual({
      mimeType: 'application/pdf',
      extension: 'pdf',
      size: PDF.length,
      title: 'Lab Result.pdf',
    });
  });

  it('does not require or look at patient-only metadata (category / description)', () => {
    expect(validateDocumentFile(file(PNG, 'image/png'))).not.toHaveProperty('category');
  });

  it('rejects an empty file (400), an oversize file (413) and a type outside the allowlist (400)', () => {
    expect(() => validateDocumentFile(file(Buffer.alloc(0), 'application/pdf'))).toThrow(
      BadRequestException
    );
    expect(() =>
      validateDocumentFile(
        file(
          Buffer.concat([PDF, Buffer.alloc(PATIENT_DOCUMENT_MAX_BYTES, 0x20)]),
          'application/pdf'
        )
      )
    ).toThrow(PayloadTooLargeException);
    expect(() => validateDocumentFile(file(PDF, 'application/dicom'))).toThrow(BadRequestException);
    expect(() =>
      validateDocumentFile(file(Buffer.from('<html><body>x</body></html>'), 'application/pdf'))
    ).toThrow(BadRequestException);
  });
});

describe('sanitizeDocumentTitle', () => {
  it('keeps only the last path segment (unix and windows separators)', () => {
    expect(sanitizeDocumentTitle('/var/www/../secret/report.pdf')).toBe('report.pdf');
    expect(sanitizeDocumentTitle('C:\\Users\\me\\scan 1.png')).toBe('scan 1.png');
  });

  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeDocumentTitle('a\r\nb\tc\u0007  d.pdf')).toBe('abc d.pdf');
  });

  it('caps the title at 120 characters', () => {
    expect(sanitizeDocumentTitle(`${'a'.repeat(300)}.pdf`)).toHaveLength(120);
  });

  it('falls back to a default for empty names', () => {
    expect(sanitizeDocumentTitle('')).toBe('Document');
    expect(sanitizeDocumentTitle(undefined)).toBe('Document');
    expect(sanitizeDocumentTitle('///')).toBe('Document');
  });
});

describe('extractDocumentStorageRef', () => {
  it('keeps the relative local-disk path as the delete reference', () => {
    expect(extractDocumentStorageRef('/storage/assets/documents/1234-doc-p-1.pdf')).toBe(
      '/storage/assets/documents/1234-doc-p-1.pdf'
    );
  });

  it('derives the object key from S3 / CDN / Contabo URLs', () => {
    const key = 'documents/0f8fad5b-d9cb-469f-a165-70867728950e-doc-p-1.pdf';
    expect(extractDocumentStorageRef(`https://cdn.example.com/${key}`)).toBe(key);
    expect(extractDocumentStorageRef(`https://bucket.s3.ap-south-1.amazonaws.com/${key}`)).toBe(
      key
    );
    expect(
      extractDocumentStorageRef(`https://eu2.contabostorage.com/access:healthcaredata/${key}`)
    ).toBe(key);
    expect(extractDocumentStorageRef(`https://cdn.example.com/${key}?X-Amz=1`)).toBe(key);
  });

  it('round-trips the name produced for an upload', () => {
    const name = buildDocumentStorageName('patient-1', 'pdf', 1700000000000);
    expect(name).toBe('doc-patient-1-1700000000000.pdf');
    expect(extractDocumentStorageRef(`https://cdn.example.com/documents/uuid-${name}`)).toBe(
      `documents/uuid-${name}`
    );
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['another folder', 'https://cdn.example.com/invoices/x.pdf'],
    ['local path in another folder', '/storage/assets/invoices/x.pdf'],
    ['traversal', '/storage/assets/documents/../../etc/passwd'],
    ['encoded traversal', 'https://cdn.example.com/documents/%2e%2e%2f%2e%2e%2fsecret'],
    ['not a url', 'garbage'],
  ])('returns null for %s', (_label, value) => {
    expect(extractDocumentStorageRef(value)).toBeNull();
  });
});

describe('extractStoredFileRef (documents/ AND medical-records/)', () => {
  it('covers exactly the two private patient-file folders', () => {
    expect([...PHI_FILE_FOLDERS]).toEqual(['documents', 'medical-records']);
  });

  it('keeps extractDocumentStorageRef documents-only', () => {
    expect(
      extractDocumentStorageRef('https://cdn.example.com/medical-records/u-doc.pdf')
    ).toBeNull();
  });

  it.each([
    [
      'S3 / CDN key',
      'https://cdn.example.com/medical-records/u-doc-r-1.pdf',
      'medical-records/u-doc-r-1.pdf',
    ],
    ['documents key', 'https://cdn.example.com/documents/u-doc-p-1.pdf', 'documents/u-doc-p-1.pdf'],
    [
      'Contabo key',
      'https://eu2.contabostorage.com/access:healthcaredata/medical-records/u-doc-r-1.pdf',
      'medical-records/u-doc-r-1.pdf',
    ],
    ['s3:// placeholder', 's3://healthcaredata/documents/u-doc-p-1.pdf', 'documents/u-doc-p-1.pdf'],
    [
      'presigned URL (query ignored)',
      'https://cdn.example.com/medical-records/u-doc-r-1.pdf?X-Amz-Signature=abc&X-Amz-Expires=900',
      'medical-records/u-doc-r-1.pdf',
    ],
    [
      'legacy nested medical-record key',
      'https://cdn.example.com/medical-records/uuid-medical-record/user-1/rec-1-17.pdf',
      'medical-records/uuid-medical-record/user-1/rec-1-17.pdf',
    ],
    [
      'local medical-records path',
      '/storage/assets/medical-records/u-doc-r-1.pdf',
      '/storage/assets/medical-records/u-doc-r-1.pdf',
    ],
    [
      'local legacy nested path',
      '/storage/assets/medical-records/uuid-medical-record/user-1/rec-1-17.pdf',
      '/storage/assets/medical-records/uuid-medical-record/user-1/rec-1-17.pdf',
    ],
  ])('derives the delete reference for %s', (_label, value, expected) => {
    expect(extractStoredFileRef(value, PHI_FILE_FOLDERS)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['undefined', undefined],
    ['another folder', 'https://cdn.example.com/invoices/x.pdf'],
    ['local path in another folder', '/storage/assets/invoices/x.pdf'],
    ['folder with no file after it', 'https://cdn.example.com/medical-records'],
    ['local folder with no file', '/storage/assets/documents/'],
    ['traversal', '/storage/assets/medical-records/../../etc/passwd'],
    ['encoded traversal', 'https://cdn.example.com/medical-records/%2e%2e%2fsecret'],
    ['backslash in a local path', '/storage/assets/documents/a\\b.pdf'],
    ['not a url', 'garbage'],
  ])('returns null for %s', (_label, value) => {
    expect(extractStoredFileRef(value, PHI_FILE_FOLDERS)).toBeNull();
  });

  it('honours the folder list it is given', () => {
    expect(
      extractStoredFileRef('https://cdn.example.com/documents/x.pdf', ['medical-records'])
    ).toBeNull();
  });
});
