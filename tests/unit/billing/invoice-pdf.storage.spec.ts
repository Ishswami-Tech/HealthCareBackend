/// <reference types="jest" />
/**
 * Invoice PDFs are stored where every replica can read them back.
 *
 * The API and worker each run one copy per node (temps-worker, oracle-main, oracle-vm2-dss) and a
 * container's disk is wiped on every deploy, so a PDF written to the local disk was only
 * downloadable from the one container that made it. With S3 configured the PDF now goes to S3
 * under `invoices/<fileName>` and the download link reads it from there; the disk is used only
 * without S3 (local development), and never as a fallback for a failed S3 write (PHI).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { InvoicePDFData } from '@core/types/billing.types';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/storage/s3-storage.service', () => ({
  S3StorageService: class S3StorageService {},
}));

import { InvoicePDFService, invoiceObjectKey } from '@services/billing/invoice-pdf.service';

const PDF_DATA: InvoicePDFData = {
  invoiceNumber: 'INV-2026-000001',
  invoiceDate: new Date('2026-11-20T10:00:00Z'),
  dueDate: new Date('2026-11-27T10:00:00Z'),
  status: 'PAID',
  clinicName: 'Test Clinic',
  userName: 'Test Patient',
  lineItems: [{ description: 'Consultation', quantity: 1, unitPrice: 500, amount: 500 }],
  subtotal: 500,
  tax: 0,
  discount: 0,
  total: 500,
};

interface FakeS3 {
  configured: boolean;
  objects: Map<string, Buffer>;
  putObject: jest.Mock;
  getObjectBuffer: jest.Mock;
  isS3Configured: () => boolean;
}

function fakeS3(configured: boolean): FakeS3 {
  const objects = new Map<string, Buffer>();
  const s3: FakeS3 = {
    configured,
    objects,
    putObject: jest.fn((key: string, body: Buffer) => {
      objects.set(key, body);
      return Promise.resolve();
    }),
    getObjectBuffer: jest.fn((key: string) => Promise.resolve(objects.get(key) ?? null)),
    isS3Configured: () => s3.configured,
  };
  return s3;
}

let workDir: string;
let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-pdf-'));
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(workDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(workDir, { recursive: true, force: true });
});

function createService(s3: FakeS3): InvoicePDFService {
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  return new InvoicePDFService({} as never, logging as never, s3 as never);
}

function localInvoiceFiles(): string[] {
  const dir = path.join(workDir, 'storage', 'invoices');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe('InvoicePDFService storage', () => {
  it('renders a PDF in memory', async () => {
    const service = createService(fakeS3(true));

    const pdf = await service.renderInvoicePDF(PDF_DATA);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(localInvoiceFiles()).toEqual([]);
  });

  it('stores the PDF in S3 under invoices/<fileName> and nothing on the local disk', async () => {
    const s3 = fakeS3(true);
    const service = createService(s3);

    const { filePath, fileName } = await service.generateInvoicePDF(PDF_DATA);

    expect(fileName).toMatch(/^invoice_INV-2026-000001_\d+-[0-9a-f]{16}\.pdf$/);
    expect(filePath).toBe(`invoices/${fileName}`);
    expect(s3.putObject).toHaveBeenCalledWith(filePath, expect.any(Buffer), 'application/pdf');
    expect(s3.objects.get(filePath)?.subarray(0, 5).toString()).toBe('%PDF-');
    expect(localInvoiceFiles()).toEqual([]);
  });

  it('lets another replica read the stored PDF back by its file name', async () => {
    const s3 = fakeS3(true);
    const { fileName } = await createService(s3).generateInvoicePDF(PDF_DATA);

    const otherReplica = createService(s3);
    const pdf = await otherReplica.getStoredInvoicePDF(fileName);

    expect(pdf).toEqual(s3.objects.get(invoiceObjectKey(fileName)));
  });

  it('never falls back to the local disk when the S3 write fails', async () => {
    const s3 = fakeS3(true);
    s3.putObject.mockRejectedValueOnce(new Error('S3 down'));
    const service = createService(s3);

    await expect(service.generateInvoicePDF(PDF_DATA)).rejects.toThrow('S3 down');
    expect(localInvoiceFiles()).toEqual([]);
  });

  it('writes to the local disk only without S3, and reads it back', async () => {
    const s3 = fakeS3(false);
    const service = createService(s3);

    const { filePath, fileName } = await service.generateInvoicePDF(PDF_DATA);

    expect(s3.putObject).not.toHaveBeenCalled();
    expect(filePath).toBe(path.join(workDir, 'storage', 'invoices', fileName));
    expect(localInvoiceFiles()).toEqual([fileName]);
    expect((await service.getStoredInvoicePDF(fileName))?.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('answers null for a PDF that is not stored, or when S3 cannot be read', async () => {
    const s3 = fakeS3(true);
    const service = createService(s3);

    await expect(service.getStoredInvoicePDF('invoice_INV-1_1.pdf')).resolves.toBeNull();

    s3.getObjectBuffer.mockRejectedValueOnce(new Error('S3 down'));
    await expect(service.getStoredInvoicePDF('invoice_INV-1_1.pdf')).resolves.toBeNull();
  });

  it.each(['../../etc/passwd', 'not-an-invoice.pdf', 'invoice_x.txt'])(
    'never reads storage for the file name %s',
    async fileName => {
      const s3 = fakeS3(true);
      const service = createService(s3);

      await expect(service.getStoredInvoicePDF(fileName)).resolves.toBeNull();
      expect(s3.getObjectBuffer).not.toHaveBeenCalled();
    }
  );
});
