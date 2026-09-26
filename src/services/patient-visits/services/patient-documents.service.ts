/**
 * Patient Documents Service (Investigations & Documents uploads)
 * @module PatientVisits
 *
 * Backed by `patient_documents` (schema.prisma `patientDocument`).
 *
 * Storage: files are ALWAYS stored privately through S3StorageService under
 * `patient-documents/{clinicId}/{patientId}/<uuid>.<ext>` (the service prefixes
 * its own uuid, so the final key is `.../<uuid>-<uuid>.<ext>`; the client file
 * name is never part of the key). With S3 disabled the service falls back to
 * `<cwd>/storage/assets/...` and `storageProvider` is recorded as `local`.
 *
 * Serving: `/patient-documents/:id/content` streams bytes through the API for
 * both providers (local → fs stream; S3 → server-side fetch of a short-lived
 * presigned URL, so browsers never hit S3 directly and no bucket CORS is
 * needed). HTTP Range is honoured for audio/video seeking. `/url` returns a
 * presigned S3 URL (10 min) for direct downloads, or the `/content` path for
 * local storage.
 *
 * Clinic isolation: a Patient.id belongs to the clinic when
 * `User.primaryClinicId === clinicId` OR the patient has at least one
 * `patient_visits` row in the clinic. Every row read/written is additionally
 * filtered by `clinicId`, and a `visitId` must belong to both the clinic and
 * the patient.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { S3StorageService } from '@infrastructure/storage/s3-storage.service';
import { LogLevel, LogType } from '@core/types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import {
  PATIENT_DOCUMENT_CATEGORIES,
  PATIENT_DOCUMENT_SUB_TYPES,
  UploadPatientDocumentFieldsDto,
} from '@dtos/patient-document.dto';
import type {
  ListPatientDocumentsQueryDto,
  PatientDocumentCategoryValue,
  PatientDocumentDisposition,
  PatientDocumentListResponse,
  PatientDocumentMediaKindValue,
  PatientDocumentResponse,
  PatientDocumentUrlResponse,
  UpdatePatientDocumentDto,
} from '@dtos/patient-document.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import { assertAllowedFile } from '@services/patient-visits/utils/file-signature.util';
import type { DetectedFile } from '@services/patient-visits/utils/file-signature.util';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';
import {
  LOCAL_STORAGE_URL_PREFIX,
  streamLocalObject,
  streamS3Object,
} from '@services/patient-visits/utils/patient-document-stream.util';
import type {
  PatientDocumentStream,
  StoredFileRef,
} from '@services/patient-visits/utils/patient-document-stream.util';

const PRESIGNED_URL_TTL_SECONDS = 600;
const CONTENT_PATH = (id: string): string => `/api/v1/patient-documents/${id}/content`;
const UPLOAD_FIELD_KEYS = [
  'patientId',
  'visitId',
  'subType',
  'title',
  'notes',
  'reportDate',
] as const;
const MAX_FILE_NAME_LENGTH = 255;
const VISIT_REF_SELECT = {
  id: true,
  patientId: true,
  clinicId: true,
  opdNumber: true,
} as PrismaDelegateArgs;

interface PatientDocumentRow {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string | null;
  category: PatientDocumentCategoryValue;
  subType: string | null;
  title: string;
  notes: string | null;
  reportDate: Date | null;
  fileName: string;
  mimeType: string;
  mediaKind: PatientDocumentMediaKindValue;
  fileSize: number;
  storageKey: string;
  storageProvider: string;
  checksum: string | null;
  labReportId: string | null;
  uploadedBy: string;
  uploadedByRole: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}

interface VisitRef {
  id: string;
  patientId: string;
  clinicId: string;
  opdNumber: string;
}

interface PatientClinicRow {
  id: string;
  userId: string;
  user?: { primaryClinicId?: string | null } | null;
}

type DocumentsClient = PrismaTransactionClientWithDelegates & {
  patientDocument: {
    create: (args: PrismaDelegateArgs) => Promise<PatientDocumentRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<PatientDocumentRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<PatientDocumentRow[]>;
    update: (args: PrismaDelegateArgs) => Promise<PatientDocumentRow>;
    count: (args: PrismaDelegateArgs) => Promise<number>;
  };
  patientVisit: {
    findFirst: (args: PrismaDelegateArgs) => Promise<VisitRef | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<VisitRef[]>;
    count: (args: PrismaDelegateArgs) => Promise<number>;
  };
};

interface StoredObject {
  storageKey: string;
  storageProvider: 's3' | 'local';
}

export type { PatientDocumentStream } from '@services/patient-visits/utils/patient-document-stream.util';

@Injectable()
export class PatientDocumentsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly storage: S3StorageService
  ) {}

  /** Number of non-deleted documents for a patient in this clinic. */
  async countForPatient(patientId: string, clinicId: string): Promise<number> {
    return this.databaseService.executeHealthcareRead<number>(async client => {
      const tc = client as unknown as DocumentsClient;
      return tc.patientDocument.count({
        where: { patientId, clinicId, deletedAt: null },
      } as PrismaDelegateArgs);
    });
  }

  async upload(
    category: PatientDocumentCategoryValue,
    file: MulterFile | null,
    rawFields: Record<string, string>,
    clinicId: string,
    actor: VisitActor
  ): Promise<PatientDocumentResponse> {
    if (!file || file.buffer.length === 0) {
      throw new BadRequestException('File is required');
    }
    const uploadedBy = actor.userId;
    if (!uploadedBy) {
      throw new ForbiddenException('Authenticated user required');
    }

    const fields = await this.validateUploadFields(rawFields);
    const detected = assertAllowedFile(file.buffer, file.mimetype, file.originalname);
    const subType = this.normalizeSubType(category, fields.subType);
    await this.assertPatientInClinic(fields.patientId, clinicId);
    const visit = fields.visitId
      ? await this.findVisitForPatient(fields.visitId, clinicId, fields.patientId)
      : null;

    const fileName = this.sanitizeFileName(file.originalname, detected.extension);
    const title = this.cleanText(fields.title) ?? fileName;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const stored = await this.storeObject(file.buffer, detected, clinicId, fields.patientId);

    let row: PatientDocumentRow;
    try {
      row = await this.databaseService.executeHealthcareWrite<PatientDocumentRow>(
        async client => {
          const tc = client as unknown as DocumentsClient;
          return tc.patientDocument.create({
            data: {
              clinicId,
              patientId: fields.patientId,
              visitId: visit?.id ?? null,
              category,
              subType,
              title,
              notes: this.cleanText(fields.notes),
              reportDate: fields.reportDate ? new Date(fields.reportDate) : null,
              fileName,
              mimeType: detected.mimeType,
              mediaKind: detected.mediaKind,
              fileSize: file.buffer.length,
              storageKey: stored.storageKey,
              storageProvider: stored.storageProvider,
              checksum,
              uploadedBy,
              uploadedByRole: actor.role ?? null,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: uploadedBy,
          clinicId,
          resourceType: 'PATIENT_DOCUMENT',
          operation: 'CREATE',
          resourceId: fields.patientId,
          userRole: actor.role || 'system',
          details: {
            patientId: fields.patientId,
            visitId: visit?.id ?? null,
            category,
            subType,
            mediaKind: detected.mediaKind,
            mimeType: detected.mimeType,
            fileSize: file.buffer.length,
            storageProvider: stored.storageProvider,
          },
        }
      );
    } catch (error) {
      await this.discardObject(stored.storageKey);
      throw error;
    }

    await this.eventService.emit('patient-document.created', {
      documentId: row.id,
      patientId: row.patientId,
      visitId: row.visitId,
      clinicId,
      category,
      mediaKind: row.mediaKind,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Patient document uploaded',
      'PatientDocumentsService',
      {
        documentId: row.id,
        patientId: row.patientId,
        clinicId,
        category,
        mediaKind: row.mediaKind,
        fileSize: row.fileSize,
        storageProvider: stored.storageProvider,
      }
    );

    return this.toResponse(row, visit?.opdNumber ?? null);
  }

  async listForPatient(
    patientId: string,
    clinicId: string,
    query: ListPatientDocumentsQueryDto
  ): Promise<PatientDocumentListResponse> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const where = {
      clinicId,
      patientId,
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.visitId ? { visitId: query.visitId } : {}),
      ...(query.subType ? { subType: query.subType.trim().toUpperCase() } : {}),
    } as PrismaDelegateArgs;

    const result = await this.databaseService.executeHealthcareRead<{
      rows: PatientDocumentRow[];
      total: number;
      opdNumbers: Map<string, string>;
    }>(async client => {
      const tc = client as unknown as DocumentsClient;
      const rows = await tc.patientDocument.findMany({
        where,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
        take: limit,
        skip: offset,
      } as PrismaDelegateArgs);
      const total = await tc.patientDocument.count({ where } as PrismaDelegateArgs);
      const opdNumbers = await this.resolveOpdNumbers(tc, rows, clinicId);
      return { rows, total, opdNumbers };
    });

    return {
      documents: result.rows.map(row =>
        this.toResponse(row, row.visitId ? (result.opdNumbers.get(row.visitId) ?? null) : null)
      ),
      total: result.total,
    };
  }

  async listForVisit(
    visitId: string,
    clinicId: string,
    category?: string
  ): Promise<PatientDocumentResponse[]> {
    const normalizedCategory = this.normalizeCategory(category);
    const result = await this.databaseService.executeHealthcareRead<{
      visit: VisitRef | null;
      rows: PatientDocumentRow[];
    }>(async client => {
      const tc = client as unknown as DocumentsClient;
      const visit = await tc.patientVisit.findFirst({
        where: { id: visitId, clinicId } as PrismaDelegateArgs,
        select: VISIT_REF_SELECT,
      } as PrismaDelegateArgs);
      if (!visit) return { visit: null, rows: [] };
      const rows = await tc.patientDocument.findMany({
        where: {
          clinicId,
          visitId,
          deletedAt: null,
          ...(normalizedCategory ? { category: normalizedCategory } : {}),
        } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return { visit, rows };
    });

    if (!result.visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    const opdNumber = result.visit.opdNumber;
    return result.rows.map(row => this.toResponse(row, opdNumber));
  }

  async getById(id: string, clinicId: string): Promise<PatientDocumentResponse> {
    const row = await this.findActiveRow(id, clinicId);
    return this.toResponse(row, await this.resolveOpdNumber(row.visitId, clinicId));
  }

  async getAccessUrl(
    id: string,
    clinicId: string,
    disposition: PatientDocumentDisposition
  ): Promise<PatientDocumentUrlResponse> {
    const row = await this.findActiveRow(id, clinicId);

    if (row.storageProvider === 's3' && this.storage.isS3Enabled()) {
      const url = await this.storage.getPresignedDownloadUrl(row.storageKey, {
        expiresIn: PRESIGNED_URL_TTL_SECONDS,
        contentType: row.mimeType,
        disposition,
        fileName: row.fileName,
      });
      await this.logAccess(row, clinicId, `presigned-${disposition}`);
      return {
        url,
        expiresAt: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000).toISOString(),
        mimeType: row.mimeType,
        disposition,
      };
    }

    const suffix = disposition === 'attachment' ? '?disposition=attachment' : '';
    return {
      url: `${CONTENT_PATH(row.id)}${suffix}`,
      expiresAt: null,
      mimeType: row.mimeType,
      disposition,
    };
  }

  async streamContent(
    id: string,
    clinicId: string,
    rangeHeader?: string
  ): Promise<PatientDocumentStream> {
    const row = await this.findActiveRow(id, clinicId);
    await this.logAccess(row, clinicId, rangeHeader ? 'stream-range' : 'stream');

    const ref: StoredFileRef = {
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      fileName: row.fileName,
      fileSize: row.fileSize,
    };
    if (row.storageProvider === 's3') {
      if (!this.storage.isS3Enabled()) {
        throw new ServiceUnavailableException('Object storage is not available');
      }
      return streamS3Object(this.storage, ref, rangeHeader);
    }
    return streamLocalObject(ref, rangeHeader);
  }

  async update(
    id: string,
    clinicId: string,
    dto: UpdatePatientDocumentDto,
    actor: VisitActor
  ): Promise<PatientDocumentResponse> {
    const existing = await this.findActiveRow(id, clinicId);
    const data: Record<string, unknown> = {};

    if (dto.title !== undefined) {
      const title = typeof dto.title === 'string' ? this.cleanText(dto.title) : null;
      if (!title) {
        throw new BadRequestException('Title cannot be empty');
      }
      data['title'] = title;
    }
    if (dto.notes !== undefined) {
      data['notes'] = typeof dto.notes === 'string' ? this.cleanText(dto.notes) : null;
    }
    if (dto.subType !== undefined) {
      data['subType'] =
        typeof dto.subType === 'string'
          ? this.normalizeSubType(existing.category, dto.subType)
          : null;
    }
    if (dto.reportDate !== undefined) {
      data['reportDate'] = typeof dto.reportDate === 'string' ? new Date(dto.reportDate) : null;
    }
    if (dto.visitId !== undefined) {
      if (typeof dto.visitId === 'string') {
        const visit = await this.findVisitForPatient(dto.visitId, clinicId, existing.patientId);
        data['visitId'] = visit.id;
      } else {
        data['visitId'] = null;
      }
    }

    if (Object.keys(data).length === 0) {
      return this.toResponse(existing, await this.resolveOpdNumber(existing.visitId, clinicId));
    }

    const row = await this.databaseService.executeHealthcareWrite<PatientDocumentRow>(
      async client => {
        const tc = client as unknown as DocumentsClient;
        return tc.patientDocument.update({
          where: { id } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'PATIENT_DOCUMENT',
        operation: 'UPDATE',
        resourceId: id,
        userRole: actor.role || 'system',
        details: { patientId: existing.patientId, updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('patient-document.updated', {
      documentId: id,
      patientId: row.patientId,
      clinicId,
    });
    return this.toResponse(row, await this.resolveOpdNumber(row.visitId, clinicId));
  }

  /** Soft delete: marks the row deleted; the stored object is retained. */
  async softDelete(id: string, clinicId: string, actor: VisitActor): Promise<void> {
    const existing = await this.findActiveRow(id, clinicId);

    await this.databaseService.executeHealthcareWrite<PatientDocumentRow>(
      async client => {
        const tc = client as unknown as DocumentsClient;
        return tc.patientDocument.update({
          where: { id } as PrismaDelegateArgs,
          data: { deletedAt: new Date(), deletedBy: actor.userId ?? null } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'PATIENT_DOCUMENT',
        operation: 'DELETE',
        resourceId: id,
        userRole: actor.role || 'system',
        details: { patientId: existing.patientId, softDelete: true },
      }
    );

    await this.eventService.emit('patient-document.deleted', {
      documentId: id,
      patientId: existing.patientId,
      visitId: existing.visitId,
      clinicId,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Patient document soft-deleted',
      'PatientDocumentsService',
      { documentId: id, patientId: existing.patientId, clinicId }
    );
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  private async storeObject(
    buffer: Buffer,
    detected: DetectedFile,
    clinicId: string,
    patientId: string
  ): Promise<StoredObject> {
    const folder = `patient-documents/${clinicId}/${patientId}`;
    const objectName = `${randomUUID()}.${detected.extension}`;
    const result = await this.storage.uploadFile(
      buffer,
      objectName,
      folder,
      detected.mimeType,
      false
    );

    if (!result.success) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Patient document storage failed',
        'PatientDocumentsService',
        { clinicId, patientId, error: result.error ?? 'unknown' }
      );
      throw new InternalServerErrorException('Could not store the uploaded file');
    }
    if (result.key) {
      return { storageKey: result.key, storageProvider: 's3' };
    }
    if (result.url && result.url.startsWith(LOCAL_STORAGE_URL_PREFIX)) {
      return { storageKey: result.url, storageProvider: 'local' };
    }
    throw new InternalServerErrorException('Storage did not return an object reference');
  }

  private async discardObject(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteFile(storageKey);
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Could not remove orphaned patient document object',
        'PatientDocumentsService',
        { storageKey, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Lookups & isolation
  // ---------------------------------------------------------------------------

  private async findActiveRow(id: string, clinicId: string): Promise<PatientDocumentRow> {
    const row = await this.databaseService.executeHealthcareRead<PatientDocumentRow | null>(
      async client => {
        const tc = client as unknown as DocumentsClient;
        return tc.patientDocument.findFirst({
          where: { id, clinicId, deletedAt: null } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!row) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return row;
  }

  private async assertPatientInClinic(patientId: string, clinicId: string): Promise<void> {
    const membership = await this.databaseService.executeHealthcareRead<
      'missing' | 'member' | 'foreign'
    >(async client => {
      const tc = client as unknown as DocumentsClient;
      const patient = (await tc.patient.findUnique({
        where: { id: patientId } as PrismaDelegateArgs,
        select: {
          id: true,
          userId: true,
          user: { select: { primaryClinicId: true } },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as PatientClinicRow | null;
      if (!patient) return 'missing';
      if (patient.user?.primaryClinicId === clinicId) return 'member';
      const visits = await tc.patientVisit.count({
        where: { patientId, clinicId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return visits > 0 ? 'member' : 'foreign';
    });

    if (membership === 'missing') {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
    if (membership === 'foreign') {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }
  }

  private async findVisitForPatient(
    visitId: string,
    clinicId: string,
    patientId: string
  ): Promise<VisitRef> {
    const visit = await this.databaseService.executeHealthcareRead<VisitRef | null>(
      async client => {
        const tc = client as unknown as DocumentsClient;
        return tc.patientVisit.findFirst({
          where: { id: visitId, clinicId } as PrismaDelegateArgs,
          select: VISIT_REF_SELECT,
        } as PrismaDelegateArgs);
      }
    );
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    if (visit.patientId !== patientId) {
      throw new BadRequestException('Visit does not belong to this patient');
    }
    return visit;
  }

  private async resolveOpdNumber(visitId: string | null, clinicId: string): Promise<string | null> {
    if (!visitId) return null;
    const visit = await this.databaseService.executeHealthcareRead<VisitRef | null>(
      async client => {
        const tc = client as unknown as DocumentsClient;
        return tc.patientVisit.findFirst({
          where: { id: visitId, clinicId } as PrismaDelegateArgs,
          select: VISIT_REF_SELECT,
        } as PrismaDelegateArgs);
      }
    );
    return visit?.opdNumber ?? null;
  }

  private async resolveOpdNumbers(
    tc: DocumentsClient,
    rows: PatientDocumentRow[],
    clinicId: string
  ): Promise<Map<string, string>> {
    const visitIds = Array.from(
      new Set(
        rows
          .map(row => row.visitId)
          .filter((visitId): visitId is string => typeof visitId === 'string' && visitId.length > 0)
      )
    );
    if (visitIds.length === 0) {
      return new Map();
    }
    const visits = await tc.patientVisit.findMany({
      where: { id: { in: visitIds }, clinicId } as PrismaDelegateArgs,
      select: VISIT_REF_SELECT,
    } as PrismaDelegateArgs);
    return new Map(visits.map(visit => [visit.id, visit.opdNumber]));
  }

  private async logAccess(row: PatientDocumentRow, clinicId: string, mode: string): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Patient document accessed',
      'PatientDocumentsService',
      { documentId: row.id, patientId: row.patientId, clinicId, mode, mediaKind: row.mediaKind }
    );
  }

  // ---------------------------------------------------------------------------
  // Validation & mapping
  // ---------------------------------------------------------------------------

  private async validateUploadFields(
    raw: Record<string, string>
  ): Promise<UploadPatientDocumentFieldsDto> {
    const picked: Record<string, string> = {};
    for (const key of UPLOAD_FIELD_KEYS) {
      const value = raw[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        picked[key] = value.trim();
      }
    }

    const dto = plainToInstance(UploadPatientDocumentFieldsDto, picked);
    const errors = await validate(dto, { whitelist: true, forbidUnknownValues: false });
    if (errors.length > 0) {
      const messages = errors.flatMap(error => Object.values(error.constraints ?? {}));
      throw new BadRequestException(
        messages.length > 0 ? messages.join('; ') : 'Invalid upload fields'
      );
    }
    return dto;
  }

  private normalizeCategory(value: string | undefined): PatientDocumentCategoryValue | null {
    if (value === undefined) return null;
    const normalized = value.trim().toUpperCase();
    if (normalized.length === 0) return null;
    const match = PATIENT_DOCUMENT_CATEGORIES.find(category => category === normalized);
    if (!match) {
      throw new BadRequestException(
        `Invalid category "${value}". Allowed: ${PATIENT_DOCUMENT_CATEGORIES.join(', ')}`
      );
    }
    return match;
  }

  private normalizeSubType(
    category: PatientDocumentCategoryValue,
    value: string | undefined
  ): string | null {
    if (value === undefined) return null;
    const normalized = value.trim().toUpperCase();
    if (normalized.length === 0) return null;
    const allowed = PATIENT_DOCUMENT_SUB_TYPES[category];
    if (!allowed.includes(normalized)) {
      throw new BadRequestException(
        `Invalid sub-type "${value}" for ${category}. Allowed: ${allowed.join(', ')}`
      );
    }
    return normalized;
  }

  /** Display/download name only — never used for the storage key. */
  private sanitizeFileName(originalName: string, extension: string): string {
    const base = Array.from(originalName.split(/[\\/]/).pop() ?? '')
      .filter(char => {
        const code = char.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f && char !== '"';
      })
      .join('')
      .trim();
    const named = base.length > 0 ? base : `document.${extension}`;
    const withExtension = /\.[A-Za-z0-9]{1,8}$/.test(named) ? named : `${named}.${extension}`;
    return withExtension.length > MAX_FILE_NAME_LENGTH
      ? withExtension.slice(withExtension.length - MAX_FILE_NAME_LENGTH)
      : withExtension;
  }

  private cleanText(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toResponse(row: PatientDocumentRow, opdNumber: string | null): PatientDocumentResponse {
    return {
      id: row.id,
      clinicId: row.clinicId,
      patientId: row.patientId,
      visitId: row.visitId ?? null,
      opdNumber,
      category: row.category,
      subType: row.subType ?? null,
      title: row.title,
      notes: row.notes ?? null,
      reportDate: row.reportDate ? new Date(row.reportDate).toISOString() : null,
      fileName: row.fileName,
      mimeType: row.mimeType,
      mediaKind: row.mediaKind,
      fileSize: row.fileSize,
      checksum: row.checksum ?? null,
      uploadedBy: row.uploadedBy,
      uploadedByRole: row.uploadedByRole ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
