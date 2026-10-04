/**
 * Cover-image helpers for the Health Library.
 *
 * The client-supplied multipart mimetype is never trusted: the real image type
 * is derived from the file's magic bytes, and only JPEG / PNG / WebP are accepted.
 */

import { BadRequestException } from '@nestjs/common';
import type { UploadResult } from '@infrastructure/storage/s3-storage.service';
import { detectMediaKind } from '@services/patient-visits/utils/file-signature.util';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';

const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface DetectedCoverImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

const COVER_IMAGE_TYPES: Readonly<Record<string, DetectedCoverImage>> = {
  'image/jpeg': { mimeType: 'image/jpeg', extension: 'jpg' },
  'image/png': { mimeType: 'image/png', extension: 'png' },
  'image/webp': { mimeType: 'image/webp', extension: 'webp' },
};

/**
 * Returns the detected image type, or null when the bytes are not JPEG/PNG/WebP. Sniffing is the
 * shared `detectMediaKind`; other images it recognises (HEIC) are not valid covers.
 */
export function detectCoverImage(buffer: Buffer): DetectedCoverImage | null {
  const detected = detectMediaKind(buffer, '');
  return detected?.mediaKind === 'IMAGE' ? (COVER_IMAGE_TYPES[detected.mimeType] ?? null) : null;
}

/** True only for absolute `https://` URLs (rejects relative `/storage/...`, `http://`, `s3://`). */
export function isAbsoluteHttpsUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates an uploaded cover: present, within the size limit and a real
 * JPEG/PNG/WebP by magic bytes (the client-declared mimetype is attacker-controlled).
 */
export function validateCoverUpload(file: MulterFile | null): {
  buffer: Buffer;
  type: DetectedCoverImage;
} {
  if (!file || file.buffer.length === 0) {
    throw new BadRequestException('Cover image file is required');
  }
  if (file.buffer.length > MAX_COVER_IMAGE_BYTES) {
    throw new BadRequestException('Cover image must be 5 MB or smaller');
  }
  const type = detectCoverImage(file.buffer);
  if (!type) {
    throw new BadRequestException('Cover image must be JPEG, PNG or WebP');
  }
  return { buffer: file.buffer, type };
}

/**
 * What `deleteAsset` needs to remove a just-stored object, whichever backend
 * wrote it: the S3 key, else the local-disk path (or its relative `/storage/...`
 * URL). An absolute URL alone identifies nothing deletable.
 */
export function storedObjectRef(uploaded: UploadResult): string | undefined {
  if (uploaded.key) return uploaded.key;
  if (uploaded.localPath) return uploaded.localPath;
  return uploaded.url?.startsWith('/') ? uploaded.url : undefined;
}
