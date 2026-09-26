/**
 * Multipart helpers for Fastify (`@fastify/multipart` registered with
 * `attachFieldsToBody: true`, see SecurityConfigService.configureMultipart).
 *
 * With that option every part is attached to `req.body`: files become objects
 * carrying `_buf`, text fields become `{ value }` objects. Neither shape can be
 * validated with a `@Body()` DTO, so controllers read the file through
 * `@FastifyFile()` and the text fields through `readMultipartFields()`.
 *
 * `FastifyFile` mirrors the decorator in patients.controller.ts.
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

export interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface MultipartItem {
  type?: string;
  _buf?: Buffer;
  data?: Buffer;
  value?: Buffer | string;
  mimetype?: string;
  filename?: string;
  length?: number;
}

function toMulterFile(item: MultipartItem | Buffer | string | undefined): MulterFile | null {
  if (!item || typeof item === 'string') return null;

  if (Buffer.isBuffer(item)) {
    return {
      buffer: item,
      mimetype: 'application/octet-stream',
      originalname: 'upload',
      size: item.length,
    };
  }

  const buffer = Buffer.isBuffer(item._buf)
    ? item._buf
    : Buffer.isBuffer(item.data)
      ? item.data
      : Buffer.isBuffer(item.value)
        ? item.value
        : Buffer.from('');

  return {
    buffer,
    mimetype: item.mimetype ?? 'application/octet-stream',
    originalname: item.filename ?? 'upload',
    size: buffer.length || 0,
  };
}

/** Reads the uploaded file (default field `file`) from the multipart body, or null. */
export const FastifyFile = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): MulterFile | null => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const fieldName = data || 'file';
    const body = (req.body || {}) as Record<string, unknown>;
    const field = body[fieldName];
    const item = (Array.isArray(field) ? field[0] : field) as
      MultipartItem | Buffer | string | undefined;
    return toMulterFile(item);
  }
);

function isFilePart(item: MultipartItem): boolean {
  return (
    item.type === 'file' ||
    Buffer.isBuffer(item._buf) ||
    Buffer.isBuffer(item.data) ||
    typeof item.filename === 'string'
  );
}

/**
 * Maps the text parts of a multipart body to plain strings, skipping files.
 * Plain-string values (JSON bodies, `keyValues` mode) pass through unchanged.
 */
export function readMultipartFields(body: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!body || typeof body !== 'object') return fields;

  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    const entry = Array.isArray(raw) ? (raw[0] as unknown) : raw;
    if (typeof entry === 'string') {
      fields[key] = entry;
      continue;
    }
    if (!entry || typeof entry !== 'object' || Buffer.isBuffer(entry)) continue;
    const item = entry as MultipartItem;
    if (isFilePart(item)) continue;
    if (typeof item.value === 'string') {
      fields[key] = item.value;
    }
  }

  return fields;
}
