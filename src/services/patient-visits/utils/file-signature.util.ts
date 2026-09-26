/**
 * File signature (magic-number) validation for patient document uploads.
 *
 * The declared MIME type and the client file name are untrusted: the media
 * kind, canonical MIME type and extension are derived from the leading bytes.
 * Anything that is not a recognised image / PDF / audio / video container is
 * rejected — in particular SVG, HTML and XML, which browsers would execute.
 */

import { BadRequestException } from '@nestjs/common';
import type { PatientDocumentMediaKindValue } from '@dtos/patient-document.dto';

export interface DetectedFile {
  mimeType: string;
  mediaKind: PatientDocumentMediaKindValue;
  extension: string;
}

const MB = 1024 * 1024;

/** Per-kind upload ceilings (bytes). OTHER is never accepted. */
export const FILE_SIZE_LIMITS: Readonly<
  Record<Exclude<PatientDocumentMediaKindValue, 'OTHER'>, number>
> = {
  IMAGE: 10 * MB,
  PDF: 20 * MB,
  AUDIO: 25 * MB,
  VIDEO: 50 * MB,
};

/** Bytes inspected for container-level hints (Ogg codec, EBML doc type). */
const HINT_WINDOW_BYTES = 256;

const HEIC_BRANDS: readonly string[] = [
  'heic',
  'heix',
  'hevc',
  'hevx',
  'mif1',
  'msf1',
  'heim',
  'heis',
];
const M4A_BRANDS: readonly string[] = ['M4A ', 'M4B ', 'M4P '];
const QUICKTIME_BRANDS: readonly string[] = ['qt  '];

function startsWithBytes(buffer: Buffer, bytes: readonly number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

function asciiAt(buffer: Buffer, offset: number, length: number): string {
  if (buffer.length < offset + length) return '';
  return buffer.subarray(offset, offset + length).toString('latin1');
}

function hintWindow(buffer: Buffer): string {
  return buffer.subarray(0, Math.min(buffer.length, HINT_WINDOW_BYTES)).toString('latin1');
}

function looksLikeMarkup(buffer: Buffer, declaredMime: string): boolean {
  const mime = declaredMime.toLowerCase();
  if (mime.includes('svg') || mime.includes('html') || mime.includes('xml')) return true;
  const head = buffer.subarray(0, Math.min(buffer.length, 64)).toString('latin1').trimStart();
  return head.startsWith('<');
}

function detectIsoBaseMedia(buffer: Buffer, declaredMime: string): DetectedFile | null {
  if (asciiAt(buffer, 4, 4) !== 'ftyp') return null;
  const brand = asciiAt(buffer, 8, 4);
  const mime = declaredMime.toLowerCase();

  if (HEIC_BRANDS.includes(brand)) {
    return { mimeType: 'image/heic', mediaKind: 'IMAGE', extension: 'heic' };
  }
  if (M4A_BRANDS.includes(brand) || mime.startsWith('audio/')) {
    return { mimeType: 'audio/mp4', mediaKind: 'AUDIO', extension: 'm4a' };
  }
  if (QUICKTIME_BRANDS.includes(brand) || mime === 'video/quicktime') {
    return { mimeType: 'video/quicktime', mediaKind: 'VIDEO', extension: 'mov' };
  }
  return { mimeType: 'video/mp4', mediaKind: 'VIDEO', extension: 'mp4' };
}

function detectRiff(buffer: Buffer): DetectedFile | null {
  if (asciiAt(buffer, 0, 4) !== 'RIFF') return null;
  const form = asciiAt(buffer, 8, 4);
  if (form === 'WEBP') {
    return { mimeType: 'image/webp', mediaKind: 'IMAGE', extension: 'webp' };
  }
  if (form === 'WAVE') {
    return { mimeType: 'audio/wav', mediaKind: 'AUDIO', extension: 'wav' };
  }
  return null;
}

function detectOgg(buffer: Buffer): DetectedFile | null {
  if (asciiAt(buffer, 0, 4) !== 'OggS') return null;
  const window = hintWindow(buffer);
  if (window.includes('theora') || window.includes('daala')) {
    return { mimeType: 'video/ogg', mediaKind: 'VIDEO', extension: 'ogv' };
  }
  return { mimeType: 'audio/ogg', mediaKind: 'AUDIO', extension: 'ogg' };
}

function detectEbml(buffer: Buffer, declaredMime: string): DetectedFile | null {
  if (!startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  const window = hintWindow(buffer);
  const isWebm = window.includes('webm');
  if (!isWebm && !window.includes('matroska')) return null;
  if (isWebm && declaredMime.toLowerCase().startsWith('audio/')) {
    // MediaRecorder audio-only captures are WebM containers declared as audio/webm.
    return { mimeType: 'audio/webm', mediaKind: 'AUDIO', extension: 'webm' };
  }
  return isWebm
    ? { mimeType: 'video/webm', mediaKind: 'VIDEO', extension: 'webm' }
    : { mimeType: 'video/x-matroska', mediaKind: 'VIDEO', extension: 'mkv' };
}

function detectMp3(buffer: Buffer): DetectedFile | null {
  const isId3 = asciiAt(buffer, 0, 3) === 'ID3';
  const first = buffer[0];
  const second = buffer[1];
  const isFrameSync =
    first === 0xff && second !== undefined && (second & 0xe0) === 0xe0 && (second & 0x06) !== 0;
  if (!isId3 && !isFrameSync) return null;
  return { mimeType: 'audio/mpeg', mediaKind: 'AUDIO', extension: 'mp3' };
}

/**
 * Identify the file from its leading bytes. Returns null for anything that is
 * not an accepted image / PDF / audio / video container.
 */
export function detectMediaKind(buffer: Buffer, declaredMime: string): DetectedFile | null {
  if (buffer.length < 12) return null;

  if (asciiAt(buffer, 0, 4) === '%PDF') {
    return { mimeType: 'application/pdf', mediaKind: 'PDF', extension: 'pdf' };
  }
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', mediaKind: 'IMAGE', extension: 'png' };
  }
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', mediaKind: 'IMAGE', extension: 'jpg' };
  }

  return (
    detectRiff(buffer) ??
    detectIsoBaseMedia(buffer, declaredMime) ??
    detectOgg(buffer) ??
    detectEbml(buffer, declaredMime) ??
    detectMp3(buffer)
  );
}

function displayName(fileName: string): string {
  const cleaned = fileName.replace(/[\r\n\t"]/g, '').trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned || 'file';
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/**
 * Validate an upload by signature and size. Throws BadRequestException with a
 * user-facing message; returns the canonical MIME type, media kind and extension.
 */
export function assertAllowedFile(
  buffer: Buffer,
  declaredMime: string,
  fileName: string
): DetectedFile {
  const name = displayName(fileName);
  if (buffer.length === 0) {
    throw new BadRequestException(`${name} is empty`);
  }
  if (looksLikeMarkup(buffer, declaredMime)) {
    throw new BadRequestException(
      `${name}: SVG, HTML and XML files are not allowed. Upload a PDF, image, audio or video file.`
    );
  }

  const detected = detectMediaKind(buffer, declaredMime);
  if (!detected || detected.mediaKind === 'OTHER') {
    throw new BadRequestException(
      `${name}: unsupported file type. Allowed: PDF, JPEG, PNG, WebP, HEIC, MP3, WAV, M4A, OGG, MP4, MOV, WebM, MKV.`
    );
  }

  const limit = FILE_SIZE_LIMITS[detected.mediaKind];
  if (buffer.length > limit) {
    throw new BadRequestException(
      `${name} is ${(buffer.length / MB).toFixed(1)} MB; the limit for ${detected.mediaKind.toLowerCase()} files is ${formatMb(limit)}.`
    );
  }

  return detected;
}
