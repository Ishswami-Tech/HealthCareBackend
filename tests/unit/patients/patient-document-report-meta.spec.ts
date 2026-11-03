import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import {
  REPORT_DATE_CONTENT_PREFIX,
  documentDownloadFileName,
  normaliseReportDate,
  readReportDateFromContent,
} from '../../../src/services/patients/patient-document.util';

const NOW = new Date('2026-10-22T06:00:00.000Z');

describe('normaliseReportDate', () => {
  it('accepts a real past date and drops a time part', () => {
    expect(normaliseReportDate('2026-10-14', NOW)).toBe('2026-10-14');
    expect(normaliseReportDate('2026-10-14T00:00:00.000Z', NOW)).toBe('2026-10-14');
  });

  it('is undefined when nothing was sent', () => {
    expect(normaliseReportDate(undefined, NOW)).toBeUndefined();
    expect(normaliseReportDate('  ', NOW)).toBeUndefined();
  });

  it.each(['14/10/2026', '2026-02-30', '2027-01-01'])('refuses %s with a 400', value => {
    expect(() => normaliseReportDate(value, NOW)).toThrow(BadRequestException);
  });
});

describe('readReportDateFromContent', () => {
  it('reads the date line written on upload', () => {
    expect(readReportDateFromContent(`${REPORT_DATE_CONTENT_PREFIX}2026-10-14`)).toBe('2026-10-14');
  });

  it('ignores any other content', () => {
    expect(readReportDateFromContent('Clinical summary')).toBeUndefined();
    expect(readReportDateFromContent(null)).toBeUndefined();
    expect(readReportDateFromContent(`${REPORT_DATE_CONTENT_PREFIX}soon`)).toBeUndefined();
  });
});

describe('documentDownloadFileName', () => {
  it('uses the display title plus the stored type extension', () => {
    expect(documentDownloadFileName('Lipid profile', 'application/pdf')).toBe('Lipid profile.pdf');
  });

  it('does not double an extension already in the title', () => {
    expect(documentDownloadFileName('scan.PDF', 'application/pdf')).toBe('scan.pdf');
    expect(documentDownloadFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpg');
  });

  it('removes path and reserved characters and falls back to "Document"', () => {
    expect(documentDownloadFileName('a/b:c', 'image/png')).toBe('b c.png');
    expect(documentDownloadFileName('', 'image/png')).toBe('Document.png');
    expect(documentDownloadFileName(null, null)).toBe('Document');
  });
});
