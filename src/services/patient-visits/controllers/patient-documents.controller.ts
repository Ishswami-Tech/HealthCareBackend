/**
 * Patient Documents Controller — Investigations & Documents uploads.
 *
 *   POST   patient-documents/investigations   (multipart: file + fields)
 *   POST   patient-documents/documents        (multipart: file + fields)
 *   GET    patient-documents/patient/:patientId?category=&visitId=&subType=&limit=&offset=
 *   GET    patient-documents/visit/:visitId?category=
 *   GET    patient-documents/:id/url?disposition=inline|attachment
 *   GET    patient-documents/:id/content?disposition=  (authenticated stream, Range support)
 *   PATCH  patient-documents/:id
 *   DELETE patient-documents/:id              (soft delete, 204)
 *
 * Uploads arrive via `@fastify/multipart` with `attachFieldsToBody: true`, so
 * the file is read with `@FastifyFile()` and the text fields with
 * `readMultipartFields()`; the service validates them against
 * `UploadPatientDocumentFieldsDto`.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { ListPatientDocumentsQueryDto, UpdatePatientDocumentDto } from '@dtos/patient-document.dto';
import type {
  PatientDocumentDisposition,
  PatientDocumentListResponse,
  PatientDocumentResponse,
  PatientDocumentUrlResponse,
} from '@dtos/patient-document.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import { PatientDocumentsService } from '@services/patient-visits/services/patient-documents.service';
import type { PatientDocumentStream } from '@services/patient-visits/services/patient-documents.service';
import {
  FastifyFile,
  readMultipartFields,
} from '@services/patient-visits/utils/fastify-file.decorator';
import type { MulterFile } from '@services/patient-visits/utils/fastify-file.decorator';

const INVESTIGATION_UPLOAD_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
  Role.LAB_TECHNICIAN,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const DOCUMENT_UPLOAD_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const WRITE_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const READ_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.LAB_TECHNICIAN,
  Role.PHARMACIST,
  Role.THERAPIST,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const DELETE_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

const UPLOAD_BODY_SCHEMA = {
  schema: {
    type: 'object',
    required: ['file', 'patientId'],
    properties: {
      file: { type: 'string', format: 'binary' },
      patientId: { type: 'string' },
      visitId: { type: 'string' },
      subType: { type: 'string' },
      title: { type: 'string' },
      notes: { type: 'string' },
      reportDate: { type: 'string', format: 'date' },
    },
  },
};

function contentDispositionHeader(
  disposition: PatientDocumentDisposition,
  fileName: string
): string {
  const asciiName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function parseDisposition(value: string | undefined): PatientDocumentDisposition {
  if (value === undefined || value === '' || value === 'inline') return 'inline';
  if (value === 'attachment') return 'attachment';
  throw new BadRequestException('disposition must be "inline" or "attachment"');
}

@ApiTags('patient-documents')
@Controller('patient-documents')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class PatientDocumentsController {
  constructor(private readonly documentsService: PatientDocumentsService) {}

  @Post('investigations')
  @Roles(...INVESTIGATION_UPLOAD_ROLES)
  @RequireResourcePermission('medical-records', 'create')
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @ApiOperation({
    summary: 'Upload an investigation (X-ray / lab / MRI / audio / video) for a patient',
  })
  async uploadInvestigation(
    @FastifyFile() file: MulterFile | null,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentResponse> {
    return this.documentsService.upload(
      'INVESTIGATION',
      file,
      readMultipartFields(req.body),
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Post('documents')
  @Roles(...DOCUMENT_UPLOAD_ROLES)
  @RequireResourcePermission('patients', 'update')
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @ApiOperation({
    summary: 'Upload a document (ID proof / consent / old prescription) for a patient',
  })
  async uploadDocument(
    @FastifyFile() file: MulterFile | null,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentResponse> {
    return this.documentsService.upload(
      'DOCUMENT',
      file,
      readMultipartFields(req.body),
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Get('patient/:patientId')
  @Roles(...READ_ROLES)
  @RequireResourcePermission('medical-records', 'read')
  @ApiOperation({ summary: 'List documents for a patient, newest first' })
  async listForPatient(
    @Param('patientId') patientId: string,
    @Query() query: ListPatientDocumentsQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentListResponse> {
    return this.documentsService.listForPatient(patientId, this.requireClinic(req), query);
  }

  @Get('visit/:visitId')
  @Roles(...READ_ROLES)
  @RequireResourcePermission('medical-records', 'read')
  @ApiOperation({ summary: 'List documents linked to one OPD visit' })
  async listForVisit(
    @Param('visitId') visitId: string,
    @Query('category') category: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentResponse[]> {
    return this.documentsService.listForVisit(visitId, this.requireClinic(req), category);
  }

  @Get(':id/url')
  @Roles(...READ_ROLES)
  @RequireResourcePermission('medical-records', 'read')
  @ApiOperation({
    summary: 'Short-lived access URL (presigned S3 URL, or the authenticated /content path)',
  })
  async getAccessUrl(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentUrlResponse> {
    return this.documentsService.getAccessUrl(
      id,
      this.requireClinic(req),
      parseDisposition(disposition)
    );
  }

  @Get(':id/content')
  @Roles(...READ_ROLES)
  @RequireResourcePermission('medical-records', 'read')
  @ApiOperation({ summary: 'Stream the file (supports HTTP Range for audio/video)' })
  async streamContent(
    @Param('id') id: string,
    @Query('disposition') disposition: string | undefined,
    @Request() req: ClinicAuthenticatedRequest,
    @Res() res: FastifyReply
  ): Promise<FastifyReply> {
    const parsedDisposition = parseDisposition(disposition);
    const content: PatientDocumentStream = await this.documentsService.streamContent(
      id,
      this.requireClinic(req),
      req.headers.range
    );

    res.header('Content-Type', content.mimeType);
    res.header(
      'Content-Disposition',
      contentDispositionHeader(parsedDisposition, content.fileName)
    );
    res.header('Content-Length', String(content.contentLength));
    res.header('Accept-Ranges', 'bytes');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('Cache-Control', 'private, no-store');
    if (content.partial) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.header('Content-Range', `bytes ${content.start}-${content.end}/${content.fileSize}`);
    }
    return res.send(content.stream);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @RequireResourcePermission('patients', 'update')
  @ApiOperation({ summary: 'Update title / notes / sub-type / report date / visit link' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDocumentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDocumentResponse> {
    return this.documentsService.update(id, this.requireClinic(req), dto, this.actor(req));
  }

  @Delete(':id')
  @Roles(...DELETE_ROLES)
  @RequireResourcePermission('patients', 'update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a document (the stored object is kept)' })
  async remove(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest): Promise<void> {
    await this.documentsService.softDelete(id, this.requireClinic(req), this.actor(req));
  }

  private requireClinic(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException('Clinic context required');
    }
    return clinicId;
  }

  private actor(req: ClinicAuthenticatedRequest): VisitActor {
    return {
      ...(req.user?.sub ? { userId: req.user.sub } : {}),
      ...(req.user?.role ? { role: req.user.role } : {}),
    };
  }
}
