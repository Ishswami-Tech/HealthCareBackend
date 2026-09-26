/**
 * Byte streaming for patient documents (local fallback storage and S3).
 *
 * Both providers are served through the authenticated `/content` endpoint so
 * the browser never talks to S3 directly (no bucket CORS needed). HTTP Range
 * requests are honoured so `<audio>`/`<video>` can seek.
 *
 * - local: `fs.createReadStream` with `{ start, end }` under `<cwd>/storage/assets`.
 * - S3: server-side `fetch` of a short-lived presigned GET with the `Range`
 *   header forwarded; the web stream is bridged to a Node `Readable`.
 */

import { BadGatewayException, HttpException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import type { ReadableStream as NodeWebReadableStream } from 'stream/web';
import type { S3StorageService } from '@infrastructure/storage/s3-storage.service';

export const LOCAL_STORAGE_URL_PREFIX = '/storage/assets/';
const STREAM_PRESIGN_TTL_SECONDS = 300;
const HTTP_RANGE_NOT_SATISFIABLE = 416;
const HTTP_PARTIAL_CONTENT = 206;

export interface StoredFileRef {
  storageKey: string;
  mimeType: string;
  fileName: string;
  /** Size recorded at upload; used when the provider does not report one. */
  fileSize: number;
}

export interface PatientDocumentStream {
  stream: Readable;
  mimeType: string;
  fileName: string;
  /** Total object size in bytes. */
  fileSize: number;
  start: number;
  end: number;
  /** True when a Range was applied (respond with 206 + Content-Range). */
  partial: boolean;
  /** Bytes in this response body. */
  contentLength: number;
}

export type ByteRange = { start: number; end: number } | null | 'unsatisfiable';

/** Parses a single `bytes=start-end` / `bytes=start-` / `bytes=-suffix` range. */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart = '', rawEnd = ''] = match;
  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd === '' ? size - 1 : Math.min(Number.parseInt(rawEnd, 10), size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) {
    return 'unsatisfiable';
  }
  return { start, end };
}

/** Maps a stored `/storage/assets/...` key to an absolute path, refusing traversal. */
export function resolveLocalStoragePath(storageKey: string): string {
  const root = path.resolve(process.cwd(), 'storage', 'assets');
  const relative = storageKey.startsWith(LOCAL_STORAGE_URL_PREFIX)
    ? storageKey.slice(LOCAL_STORAGE_URL_PREFIX.length)
    : storageKey;
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${root}${path.sep}`)) {
    throw new NotFoundException('File not found');
  }
  return absolute;
}

export async function streamLocalObject(
  ref: StoredFileRef,
  rangeHeader: string | undefined
): Promise<PatientDocumentStream> {
  const absolutePath = resolveLocalStoragePath(ref.storageKey);
  let size: number;
  try {
    size = (await fs.promises.stat(absolutePath)).size;
  } catch {
    throw new NotFoundException('File is missing from storage');
  }

  const range = parseRangeHeader(rangeHeader, size);
  if (range === 'unsatisfiable') {
    throw new HttpException('Range not satisfiable', HTTP_RANGE_NOT_SATISFIABLE);
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(size - 1, 0);
  const stream = size === 0 ? Readable.from([]) : fs.createReadStream(absolutePath, { start, end });

  return {
    stream,
    mimeType: ref.mimeType,
    fileName: ref.fileName,
    fileSize: size,
    start,
    end,
    partial: range !== null,
    contentLength: size === 0 ? 0 : end - start + 1,
  };
}

export async function streamS3Object(
  storage: S3StorageService,
  ref: StoredFileRef,
  rangeHeader: string | undefined
): Promise<PatientDocumentStream> {
  const url = await storage.getPresignedDownloadUrl(ref.storageKey, {
    expiresIn: STREAM_PRESIGN_TTL_SECONDS,
    contentType: ref.mimeType,
    disposition: 'inline',
  });
  const response = await fetch(url, {
    headers: rangeHeader ? { Range: rangeHeader } : {},
  });

  if (response.status === HTTP_RANGE_NOT_SATISFIABLE) {
    throw new HttpException('Range not satisfiable', HTTP_RANGE_NOT_SATISFIABLE);
  }
  if (response.status === 404) {
    throw new NotFoundException('File is missing from storage');
  }
  if (!response.ok || !response.body) {
    throw new BadGatewayException('Object storage did not return the file');
  }

  const partial = response.status === HTTP_PARTIAL_CONTENT;
  const reportedLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  const bodyLength = Number.isFinite(reportedLength) ? reportedLength : ref.fileSize;
  let start = 0;
  let end = Math.max(bodyLength - 1, 0);
  let fileSize = bodyLength;
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
    response.headers.get('content-range') ?? ''
  );
  if (partial && contentRange) {
    const [, rangeStart = '0', rangeEnd = '0', total = '*'] = contentRange;
    start = Number.parseInt(rangeStart, 10);
    end = Number.parseInt(rangeEnd, 10);
    fileSize = total === '*' ? ref.fileSize : Number.parseInt(total, 10);
  }

  return {
    stream: Readable.fromWeb(response.body as unknown as NodeWebReadableStream),
    mimeType: ref.mimeType,
    fileName: ref.fileName,
    fileSize,
    start,
    end,
    partial,
    contentLength: bodyLength,
  };
}
