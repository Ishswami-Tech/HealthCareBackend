/// <reference types="jest" />
/**
 * A failed multipart upload used to crash log serialisation.
 *
 * The exception filter copied `request.body` into the error log. For multipart requests the body
 * holds uploaded-file objects whose `fields` property points back at the body, so
 * `JSON.stringify` threw "Converting circular structure to JSON" inside `LoggingService.log`.
 * The caller uses `void log(...)`, so the throw became an unhandled rejection and the entry was
 * lost. Both layers now serialise safely.
 */

import { HttpExceptionFilter } from '@core/filters/http-exception.filter';
import { LoggingService } from '@infrastructure/logging/logging.service';

interface FilterInternals {
  toLogSafe(value: unknown, depth: number): unknown;
}

interface LoggingInternals {
  safeStringify(value: unknown): string;
}

const filter = Object.create(HttpExceptionFilter.prototype) as unknown as FilterInternals;
const logging = Object.create(LoggingService.prototype) as unknown as LoggingInternals;

const multipartBody = (): Record<string, unknown> => {
  const body: Record<string, unknown> = { category: 'LAB_REPORT', description: 'CBC report' };
  const file = {
    type: 'file',
    fieldname: 'file',
    filename: 'report.pdf',
    mimetype: 'application/pdf',
    fields: body,
    toBuffer: (): Promise<Buffer> => Promise.resolve(Buffer.from('%PDF-secret-content')),
  };
  body['file'] = file;
  return body;
};

describe('HttpExceptionFilter.toLogSafe', () => {
  it('turns a circular multipart body into JSON-safe data', () => {
    const safe = filter.toLogSafe(multipartBody(), 0);

    expect(() => JSON.stringify(safe)).not.toThrow();
    expect(safe).toMatchObject({ category: 'LAB_REPORT', description: 'CBC report' });
  });

  it('replaces uploaded files with a placeholder and never logs their content', () => {
    const serialised = JSON.stringify(filter.toLogSafe(multipartBody(), 0));

    expect(serialised).toContain('[Uploaded file]');
    expect(serialised).not.toContain('secret-content');
  });

  it('replaces buffers, class instances and unsupported values with placeholders', () => {
    class Handle {
      secret = 'socket';
    }
    const safe = filter.toLogSafe(
      { raw: Buffer.alloc(4), handle: new Handle(), fn: () => 1, at: new Date(0) },
      0
    ) as Record<string, unknown>;

    expect(safe['raw']).toBe('[Buffer 4 bytes]');
    expect(safe['handle']).toBe('[Object]');
    expect(safe['fn']).toBe('[Unsupported]');
    expect(safe['at']).toBe('1970-01-01T00:00:00.000Z');
  });

  it('limits depth and array length', () => {
    const deep = {
      a: { b: { c: { d: 'too deep' } } },
      list: Array.from({ length: 50 }, (_, i) => i),
    };
    const safe = filter.toLogSafe(deep, 0) as { a: { b: { c: unknown } }; list: number[] };

    expect(safe.a.b.c).toBe('[Object]');
    expect(safe.list).toHaveLength(20);
  });
});

describe('LoggingService.safeStringify', () => {
  it('does not throw on circular structures and marks the cycle', () => {
    const entry: Record<string, unknown> = { message: 'upload failed' };
    entry['self'] = entry;

    const json = logging.safeStringify(entry);

    expect(JSON.parse(json)).toEqual({ message: 'upload failed', self: '[Circular]' });
  });

  it('serialises BigInt values instead of throwing', () => {
    expect(JSON.parse(logging.safeStringify({ amount: BigInt(12) }))).toEqual({ amount: '12' });
  });

  it('leaves ordinary entries unchanged', () => {
    const entry = { id: '1', level: 'ERROR', metadata: { statusCode: 400 } };

    expect(JSON.parse(logging.safeStringify(entry))).toEqual(entry);
  });
});
