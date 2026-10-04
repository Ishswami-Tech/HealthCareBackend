/**
 * Pure helpers for patient-uploaded documents (POST/DELETE /patients/:id/documents).
 *
 * Kept free of Nest providers so the validation rules and the storage-key
 * derivation can be unit-tested without a database or an object store.
 */

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { AssetType } from '@infrastructure/storage/static-asset.service';
import type { DatabaseService } from '@infrastructure/database/database.service';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import { detectMediaKind } from '@services/patient-visits/utils/file-signature.util';

const MB = 1024 * 1024;

/** Largest accepted upload (bytes). */
export const PATIENT_DOCUMENT_MAX_BYTES = 10 * MB;
export const PATIENT_DOCUMENT_TITLE_MAX_LENGTH = 120;
export const PATIENT_DOCUMENT_CATEGORY_MAX_LENGTH = 50;
export const PATIENT_DOCUMENT_DESCRIPTION_MAX_LENGTH = 500;

/** Canonical MIME types a patient may upload. */
export const PATIENT_DOCUMENT_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

/** Categories the mobile "My documents" screen sends (app/documents.tsx). */
export const PATIENT_DOCUMENT_CATEGORIES: readonly string[] = [
  'LAB_REPORT',
  'IMAGING',
  'PRESCRIPTION',
  'INSURANCE',
  'ID_PROOF',
  'OTHER',
];

/**
 * Category names other clients send (web "My documents" UI: LAB_TEST, XRAY,
 * DIAGNOSIS_REPORT) mapped to the canonical categories above. Keys are compared after
 * the same upper-casing / separator normalisation as the canonical names.
 */
export const PATIENT_DOCUMENT_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  LAB_TEST: 'LAB_REPORT',
  LAB_RESULT: 'LAB_REPORT',
  LAB: 'LAB_REPORT',
  DIAGNOSIS_REPORT: 'LAB_REPORT',
  DIAGNOSTIC_REPORT: 'LAB_REPORT',
  XRAY: 'IMAGING',
  X_RAY: 'IMAGING',
  SCAN: 'IMAGING',
  MRI: 'IMAGING',
  CT: 'IMAGING',
  ULTRASOUND: 'IMAGING',
  RADIOLOGY: 'IMAGING',
  RX: 'PRESCRIPTION',
  MEDICATION: 'PRESCRIPTION',
  INSURANCE_CARD: 'INSURANCE',
  INSURANCE_POLICY: 'INSURANCE',
  ID: 'ID_PROOF',
  IDENTITY: 'ID_PROOF',
  ID_CARD: 'ID_PROOF',
};

const DEFAULT_CATEGORY = 'OTHER';
const DEFAULT_TITLE = 'Document';

/** Aliases some clients send for an allowed type. */
const MIME_ALIASES: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
};

/** Clients that cannot determine a type send these; the file signature decides instead. */
const GENERIC_MIME_TYPES: readonly string[] = [
  '',
  'application/octet-stream',
  'binary/octet-stream',
];

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export interface PatientDocumentFileInput {
  readonly buffer: Buffer;
  readonly mimetype: string;
  readonly originalname: string;
}

export interface PatientDocumentMetaInput {
  readonly category?: string | undefined;
  readonly description?: string | undefined;
}

/** A file that passed size / type / signature validation. */
export interface ValidatedDocumentFile {
  /** Canonical MIME type, taken from the file signature (never the client header). */
  readonly mimeType: string;
  readonly extension: string;
  readonly size: number;
  /** Sanitised display name (max 120 chars). */
  readonly title: string;
}

export interface ValidatedPatientDocument extends ValidatedDocumentFile {
  readonly category: string;
  readonly description?: string;
}

function normaliseDeclaredMime(raw: string | undefined): string {
  const base = (raw ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_ALIASES[base] ?? base;
}

/**
 * Display name for a stored document: path separators and control characters
 * removed, markup characters dropped, whitespace collapsed, max 120 chars.
 */
export function sanitizeDocumentTitle(raw: string | undefined): string {
  const lastSegment = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const withoutControlChars = Array.from(lastSegment)
    .filter(char => {
      const code = char.codePointAt(0) ?? 0;
      // C0 controls (incl. newline/tab), DEL and C1 controls
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('');
  const cleaned = withoutControlChars
    .replace(/[<>"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = cleaned.slice(0, PATIENT_DOCUMENT_TITLE_MAX_LENGTH).trim();
  return title.length > 0 ? title : DEFAULT_TITLE;
}

function normaliseCategory(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return DEFAULT_CATEGORY;
  }
  if (trimmed.length > PATIENT_DOCUMENT_CATEGORY_MAX_LENGTH) {
    throw new BadRequestException(
      `Category must be at most ${PATIENT_DOCUMENT_CATEGORY_MAX_LENGTH} characters`
    );
  }
  const upper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
  const normalised = PATIENT_DOCUMENT_CATEGORY_ALIASES[upper] ?? upper;
  if (!PATIENT_DOCUMENT_CATEGORIES.includes(normalised)) {
    throw new BadRequestException(
      `Unsupported category "${trimmed}". Allowed: ${PATIENT_DOCUMENT_CATEGORIES.join(', ')}`
    );
  }
  return normalised;
}

function normaliseDescription(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > PATIENT_DOCUMENT_DESCRIPTION_MAX_LENGTH) {
    throw new BadRequestException(
      `Description must be at most ${PATIENT_DOCUMENT_DESCRIPTION_MAX_LENGTH} characters`
    );
  }
  return trimmed;
}

/**
 * Validates the file part of an upload (patient documents AND staff EHR
 * medical-record files) before anything is stored.
 *
 * - 400 for an empty file or a type outside the allowlist (declared header AND
 *   file signature must both be PDF / JPEG / PNG / WebP / HEIC)
 * - 413 when the file exceeds 10 MB
 */
export function validateDocumentFile(file: PatientDocumentFileInput): ValidatedDocumentFile {
  const size = file.buffer?.length ?? 0;
  if (size === 0) {
    throw new BadRequestException('The uploaded file is empty');
  }
  if (size > PATIENT_DOCUMENT_MAX_BYTES) {
    throw new PayloadTooLargeException(
      `File is ${(size / MB).toFixed(1)} MB; the limit is ${PATIENT_DOCUMENT_MAX_BYTES / MB} MB`
    );
  }

  const allowedList = 'PDF, JPEG, PNG, WebP or HEIC';
  const declared = normaliseDeclaredMime(file.mimetype);
  if (!GENERIC_MIME_TYPES.includes(declared) && !PATIENT_DOCUMENT_MIME_TYPES.includes(declared)) {
    throw new BadRequestException(`Unsupported file type. Allowed: ${allowedList}`);
  }

  // The declared type is client-controlled; the leading bytes decide.
  const detected = detectMediaKind(file.buffer, declared);
  if (!detected || !PATIENT_DOCUMENT_MIME_TYPES.includes(detected.mimeType)) {
    throw new BadRequestException(`Unsupported file type. Allowed: ${allowedList}`);
  }

  return {
    mimeType: detected.mimeType,
    extension: EXTENSION_BY_MIME[detected.mimeType] ?? detected.extension,
    size,
    title: sanitizeDocumentTitle(file.originalname),
  };
}

/** Largest accepted profile photo (bytes). */
export const PROFILE_PHOTO_MAX_BYTES = 5 * MB;

/** Image types a profile photo may have (a PDF is a valid document but not a photo). */
export const PROFILE_PHOTO_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

/**
 * Validates a profile photo with the same rules as documents (non-empty, signature-
 * checked type, <= 10 MB) plus: images only and at most 5 MB. 400 / 413 on violation.
 */
export function validateProfilePhotoFile(file: PatientDocumentFileInput): ValidatedDocumentFile {
  const validated = validateDocumentFile(file);
  if (!PROFILE_PHOTO_MIME_TYPES.includes(validated.mimeType)) {
    throw new BadRequestException('Profile photo must be a JPEG, PNG, WebP or HEIC image');
  }
  if (validated.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new PayloadTooLargeException(
      `Photo is ${(validated.size / MB).toFixed(1)} MB; the limit is ${PROFILE_PHOTO_MAX_BYTES / MB} MB`
    );
  }
  return validated;
}

/** Storage name of a profile photo; it carries the user id so the signed URL can be bound to it. */
export function buildProfilePhotoStorageName(
  userId: string,
  extension: string,
  now: number = Date.now()
): string {
  return `avatar-${userId}-${now}.${extension}`;
}

/**
 * Validates a patient upload (file + metadata) before anything is stored.
 *
 * - 400 for an empty file, a type outside the allowlist (declared header AND
 *   file signature), an unknown category or an over-long description
 * - 413 when the file exceeds 10 MB
 */
export function validatePatientDocumentUpload(
  file: PatientDocumentFileInput,
  meta: PatientDocumentMetaInput = {}
): ValidatedPatientDocument {
  const validatedFile = validateDocumentFile(file);
  const description = normaliseDescription(meta.description);
  return {
    ...validatedFile,
    category: normaliseCategory(meta.category),
    ...(description ? { description } : {}),
  };
}

/**
 * Reference `StaticAssetService.deleteAsset` needs to remove a stored document,
 * derived from the `fileUrl` saved on the HealthRecord.
 *
 * Uploads are stored under `AssetType.DOCUMENT` as `<folder>/<uuid>-<name>`:
 *  - local disk  -> fileUrl `/storage/assets/documents/<uuid>-<name>` (relative path)
 *  - S3 / CDN    -> fileUrl `<base>/documents/<uuid>-<name>`, key `documents/<uuid>-<name>`
 *
 * Returns null for anything that does not look like a stored document (other
 * folders, traversal attempts, empty values) so a tampered `fileUrl` can never
 * point the delete at an arbitrary object.
 */
export function extractDocumentStorageRef(fileUrl: string | null | undefined): string | null {
  return extractStoredFileRef(fileUrl, [AssetType.DOCUMENT]);
}

/**
 * Folders (= `AssetType.DOCUMENT` and `AssetType.MEDICAL_RECORD`) that hold private
 * patient files. Patient documents are `HealthRecord` rows of type GENERAL_DOCUMENT, but
 * the EHR medical-record upload stores its files under `medical-records/`, so a
 * document row can reference either folder. Literals (not `AssetType`) so the constant
 * can be evaluated at module load.
 */
export const PHI_FILE_FOLDERS: readonly string[] = ['documents', 'medical-records'];

/**
 * Delete reference of a stored private file, derived from a stored (or presigned)
 * `fileUrl`. The file must live under one of `folders`:
 *  - local disk  -> `/storage/assets/<folder>/<path>` (relative URL, kept as is)
 *  - S3 / CDN    -> `<folder>/<path>` (the object key; any base path / host is dropped)
 *
 * `<path>` may have several segments (legacy medical-record keys are nested:
 * `medical-records/<uuid>-medical-record/<userId>/<recordId>-<ts>.pdf`).
 * Returns null for anything else (other folders, traversal, empty values), so a
 * tampered value can never point a delete at an arbitrary object.
 */
export function extractStoredFileRef(
  fileUrl: string | null | undefined,
  folders: readonly string[]
): string | null {
  const value = (fileUrl ?? '').trim();
  if (value.length === 0) {
    return null;
  }

  let pathname = value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\\')) {
    return null;
  }

  const segments = decoded.split('/').filter(segment => segment.length > 0);
  const isLocal = value.startsWith('/storage/assets/');
  // local: `storage/assets/<folder>/...`; remote: the folder is the first matching segment
  // after the (unknown) base path.
  const folderIndex = isLocal ? 2 : segments.findIndex(segment => folders.includes(segment));
  const folder = segments[folderIndex];
  if (folderIndex < 0 || folder === undefined || !folders.includes(folder)) {
    return null;
  }
  const rest = segments.slice(folderIndex + 1);
  if (rest.length === 0) {
    return null;
  }

  const key = [folder, ...rest].join('/');
  return isLocal ? `/storage/assets/${key}` : key;
}

/** Storage file name for a validated upload (the store prefixes its own uuid). */
export function buildDocumentStorageName(
  patientRecordId: string,
  extension: string,
  now: number = Date.now()
): string {
  return `doc-${patientRecordId}-${now}.${extension}`;
}

/**
 * `HealthRecord.doctorId` is a required FK to Doctor.id. Resolves the doctor a patient
 * document / self-created medical record is attributed to, deterministically:
 *   1. the uploader, if they are a doctor;
 *   2. the doctor of the patient's most recent appointment in this clinic;
 *   3. the longest-standing ACTIVE doctor linked to this clinic.
 * Returns null when the clinic has no usable doctor (callers reject with a clear message
 * instead of picking an arbitrary row). Shared by the patient documents upload and the
 * EHR medical-record create so both attribute records identically.
 */
export async function resolveAttributionDoctorId(
  databaseService: DatabaseService,
  patientRecordId: string,
  uploaderUserId: string,
  clinicId: string
): Promise<string | null> {
  return await databaseService.executeHealthcareRead(async client => {
    const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
      doctor: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      appointment: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
      doctorClinic: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
    };
    const ownDoctor = (await typedClient.doctor.findUnique({
      where: { userId: uploaderUserId } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as { id: string } | null;
    if (ownDoctor?.id) return ownDoctor.id;

    const lastAppointment = (await typedClient.appointment.findFirst({
      where: { patientId: patientRecordId, clinicId } as PrismaDelegateArgs,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      select: { doctorId: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as { doctorId: string } | null;
    if (lastAppointment?.doctorId) return lastAppointment.doctorId;

    // Deterministic: an unordered findFirst returned whichever doctor row the planner
    // happened to hit first (possibly a deactivated one).
    const clinicDoctor = (await typedClient.doctorClinic.findFirst({
      where: { clinicId, doctor: { user: { isActive: true } } } as PrismaDelegateArgs,
      orderBy: [{ doctor: { createdAt: 'asc' } }, { doctorId: 'asc' }],
      select: { doctorId: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as { doctorId: string } | null;
    return clinicDoctor?.doctorId ?? null;
  });
}
