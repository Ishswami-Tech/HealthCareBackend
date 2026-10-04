import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreatePatientDto, UpdatePatientDto } from '@dtos/patient.dto';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PatientsService } from '../patients.service';
import { PatientDashboardSummaryDto } from '../dashboard-summary.dto';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface MultipartItem {
  _buf?: Buffer;
  data?: Buffer;
  value?: Buffer | string;
  mimetype?: string;
  filename?: string;
  length?: number;
}

export const FastifyFile = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<import('fastify').FastifyRequest>();
    const fieldName = data || 'file';
    const body = (req.body || {}) as Record<string, unknown>;
    const field = body[fieldName];
    const item = (Array.isArray(field) ? field[0] : field) as
      MultipartItem | Buffer | string | undefined;

    if (!item) return null;
    if (typeof item === 'string') {
      return null; // Not a file
    }

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
);

@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
@ApiBearerAuth()
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('patients', 'create')
  @ApiOperation({ summary: 'Create or update patient profile' })
  @ApiBody({ type: CreatePatientDto })
  @ApiResponse({ status: 201, description: 'Patient profile created/updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Validation failed' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async createPatient(@Body() dto: CreatePatientDto, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId || dto.clinicId;
    const role = req.user?.role;

    if (
      clinicId &&
      role !== Role.PATIENT &&
      dto.clinicId &&
      req.clinicContext?.clinicId &&
      dto.clinicId !== req.clinicContext.clinicId
    ) {
      throw new ForbiddenException('Cannot create or update a patient for a different clinic');
    }

    if (clinicId && role !== Role.PATIENT) {
      const inClinic = await this.patientsService.isPatientInClinic(dto.userId, clinicId);
      if (!inClinic) {
        throw new ForbiddenException('Patient does not belong to your clinic');
      }
    }

    return this.patientsService.createOrUpdatePatient({
      userId: dto.userId,
      ...(clinicId != null && { clinicId }),
      ...(dto.dateOfBirth != null && { dateOfBirth: dto.dateOfBirth }),
      ...(dto.gender != null && { gender: dto.gender as 'MALE' | 'FEMALE' | 'OTHER' }),
      ...(dto.bloodGroup != null && { bloodGroup: dto.bloodGroup }),
      ...(dto.occupation != null && { occupation: dto.occupation }),
      ...(dto.maritalStatus != null && { maritalStatus: dto.maritalStatus }),
      ...(dto.height != null && { height: dto.height }),
      ...(dto.weight != null && { weight: dto.weight }),
      ...(dto.allergies != null && { allergies: dto.allergies }),
      ...(dto.medicalHistory != null && { medicalHistory: dto.medicalHistory }),
      ...(dto.emergencyContact != null && { emergencyContact: dto.emergencyContact }),
      ...(dto.insurance != null && { insurance: dto.insurance }),
    });
  }

  @Post(':id/documents')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload patient document' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded successfully' })
  async uploadDocument(
    @Param('id') patientId: string,
    @FastifyFile() file: MulterFile,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic ID not found in context');
    }

    // Clinic membership of the patient and PATIENT ownership (own record or an ACTIVE
    // dependent's) are enforced in PatientsService.uploadPatientDocument (403).

    // Multipart text fields arrive on req.body either as plain strings or as
    // fastify-multipart field objects ({ value }). Only the raw trimmed text is read
    // here; the allowlist / length rules live in the service so they also apply to
    // any other caller (400 on violation).
    const body = ((req as unknown as { body?: Record<string, unknown> }).body || {}) as Record<
      string,
      unknown
    >;
    const readField = (name: string): string | undefined => {
      const raw = Array.isArray(body[name]) ? (body[name] as unknown[])[0] : body[name];
      if (typeof raw === 'string') return raw.trim() || undefined;
      if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
        const v = (raw as { value?: unknown }).value;
        return typeof v === 'string' ? v.trim() || undefined : undefined;
      }
      return undefined;
    };
    const category = readField('category');
    const description = readField('description');

    return await this.patientsService.uploadPatientDocument(
      patientId,
      file,
      {
        userId,
        userRole: req.user?.role || Role.PATIENT,
        operation: 'CREATE',
        resourceType: 'HEALTH_RECORD',
        clinicId,
      },
      {
        ...(category ? { category } : {}),
        ...(description ? { description } : {}),
      }
    );
  }

  /**
   * Replace the profile photo of the patient whose User.id is `:id` (multipart field
   * `file`: JPEG / PNG / WebP / HEIC, max 5 MB). PATIENT: own photo only; staff: patients
   * of their clinic. 400 wrong type, 413 too large, 403 someone else's profile. The
   * response `profilePicture` is a presigned URL (15 minutes); profile reads re-sign it.
   */
  @Post(':id/profile-photo')
  @Roles(Role.PATIENT, Role.RECEPTIONIST, Role.DOCTOR, Role.CLINIC_ADMIN)
  @RequireResourcePermission('profile', 'update')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload / replace a patient profile photo' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 201, description: 'Photo stored; returns a presigned URL' })
  async uploadProfilePhoto(
    @Param('id') userId: string,
    @FastifyFile() file: MulterFile | null,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const actorId = req.user?.id || req.user?.sub;
    const clinicId = req.clinicContext?.clinicId;
    if (!actorId || !clinicId) {
      throw new BadRequestException('User or clinic not found in request');
    }
    return await this.patientsService.uploadProfilePhoto(userId, file, {
      userId: actorId,
      userRole: req.user?.role || Role.PATIENT,
      operation: 'UPDATE',
      resourceType: 'USER',
      clinicId,
    });
  }

  // PATIENT: own record / ACTIVE dependent, all clinics. Staff: clinical role + the
  // medical-records:read permission, request-clinic documents only (both checked in
  // PatientsService.listPatientDocuments). NOTE: RECEPTIONIST DOES hold
  // medical-records:read in rbac.service.ts; it is kept out only by this @Roles list AND
  // by the explicit role allow-list inside the service, so widening @Roles alone cannot
  // expose documents.
  @Get(':id/documents')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'List patient documents' })
  @ApiResponse({ status: 200, description: 'Documents retrieved successfully' })
  async listDocuments(@Param('id') patientId: string, @Request() req: ClinicAuthenticatedRequest) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic ID not found in context');
    }
    return await this.patientsService.listPatientDocuments(patientId, {
      userId,
      userRole: req.user?.role || Role.PATIENT,
      operation: 'READ',
      resourceType: 'HEALTH_RECORD',
      clinicId,
    });
  }

  // PATIENT: only own (or ACTIVE dependent's) documents they uploaded. Staff: clinical
  // role + medical-records:delete (checked in PatientsService.deletePatientDocument,
  // which also denies every non-clinical role such as RECEPTIONIST explicitly).
  @Delete(':id/documents/:documentId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Delete a patient document' })
  @ApiResponse({ status: 200, description: 'Document deleted successfully' })
  async deleteDocument(
    @Param('id') patientId: string,
    @Param('documentId') documentId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic ID not found in context');
    }
    return await this.patientsService.deletePatientDocument(patientId, documentId, {
      userId,
      userRole: req.user?.role || Role.PATIENT,
      operation: 'DELETE',
      resourceType: 'HEALTH_RECORD',
      clinicId,
    });
  }

  @Get(':id/insurance')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @RequireResourcePermission('patients', 'read', { requireOwnership: true })
  @ApiOperation({ summary: 'Get patient insurance details' })
  @ApiResponse({ status: 200, description: 'Insurance details retrieved successfully' })
  async getInsurance(@Param('id') patientId: string, @Request() req: ClinicAuthenticatedRequest) {
    const role = req.user?.role;
    const clinicId = req.clinicContext?.clinicId;

    if (role !== Role.PATIENT && clinicId) {
      const inClinic = await this.patientsService.isPatientInClinic(patientId, clinicId);
      if (!inClinic) {
        throw new ForbiddenException('Patient does not belong to your clinic');
      }
    }

    return await this.patientsService.getInsurance(patientId, clinicId);
  }

  /**
   * Self-served patient dashboard summary — composed in a single
   * round-trip from appointments, EHR, prescriptions, invoices, and
   * payments. Cached server-side for 60 seconds. See
   * `PatientsService.getDashboardSummary` for resilience details.
   *
   * Patient-only. Clinic staff should hit the staff analytics endpoint
   * (`/api/analytics/dashboard`) instead.
   */
  @Get('me/dashboard-summary')
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'Get current patient dashboard summary',
    description:
      'Composed single-round-trip view of appointments, prescriptions, ' +
      'EHR summary, invoices, and payments for the authenticated patient. ' +
      'Cached server-side for 60 seconds; invalidated on relevant lifecycle ' +
      'events. Sub-calls are best-effort: a failing sub-call returns empty ' +
      'data for that field plus an `errors` map; the endpoint never throws ' +
      'on a partial failure.',
  })
  @ApiResponse({
    status: 200,
    description: 'Summary composed successfully (possibly partial)',
    type: PatientDashboardSummaryDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — patient-only or profile incomplete',
  })
  @ApiResponse({ status: 400, description: 'Bad request — no user id in token' })
  async getMyDashboardSummary(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDashboardSummaryDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new BadRequestException('User ID not found in token');
    }
    const clinicId = req.clinicContext?.clinicId;
    return this.patientsService.getDashboardSummary(userId, clinicId);
  }

  @Get()
  @Roles(
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST
  )
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Get all patients for the current clinic' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of patients retrieved successfully' })
  async findAll(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic ID not found in context');
    }
    const doctorUserId =
      req.user?.role === Role.DOCTOR || req.user?.role === Role.ASSISTANT_DOCTOR
        ? (req.user?.id ?? req.user?.sub)
        : undefined;
    const hasPagination = page !== undefined || limit !== undefined || search !== undefined;
    if (hasPagination) {
      return this.patientsService.getClinicPatientsPaginated(
        clinicId,
        {
          page: page ? Number.parseInt(page, 10) : 1,
          limit: limit ? Number.parseInt(limit, 10) : 50,
          ...(search?.trim() ? { searchTerm: search.trim() } : {}),
        },
        doctorUserId
      );
    }
    return this.patientsService.getClinicPatients(clinicId, undefined, doctorUserId);
  }

  @Get('clinic/:clinicId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Get all patients for a clinic' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Clinic patients retrieved successfully' })
  async getClinicPatients(
    @Param('clinicId') paramClinicId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined
  ) {
    // 🔒 TENANT ISOLATION: Always use validated clinicId from guard context
    const validatedClinicId = req.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    // Reject if URL param doesn't match validated context (prevents URL manipulation)
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot access patients from a different clinic');
    }
    const doctorUserId =
      req.user?.role === Role.DOCTOR || req.user?.role === Role.ASSISTANT_DOCTOR
        ? (req.user?.id ?? req.user?.sub)
        : undefined;

    const hasPagination = page !== undefined || limit !== undefined || search !== undefined;
    if (hasPagination) {
      return this.patientsService.getClinicPatientsPaginated(
        validatedClinicId,
        {
          page: page ? Number.parseInt(page, 10) : 1,
          limit: limit ? Number.parseInt(limit, 10) : 50,
          ...(search?.trim() ? { searchTerm: search.trim() } : {}),
        },
        doctorUserId
      );
    }

    return this.patientsService.getClinicPatients(validatedClinicId, search, doctorUserId);
  }

  @Get(':id')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.PATIENT
  )
  @RequireResourcePermission('patients', 'read', { requireOwnership: true })
  @ApiOperation({ summary: 'Get patient profile by ID (User ID)' })
  @ApiResponse({ status: 200, description: 'Patient profile retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async getPatient(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    const role = req.user?.role;
    if (role === Role.PATIENT) {
      await this.patientsService.ensurePatientProfile(id);
    }
    if (role !== Role.PATIENT && clinicId) {
      const inClinic = await this.patientsService.isPatientInClinic(id, clinicId);
      if (!inClinic) {
        throw new ForbiddenException('Patient does not belong to your clinic');
      }
    }
    return this.patientsService.getPatientProfile(id);
  }

  @Put(':id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('patients', 'update')
  @ApiOperation({ summary: 'Update patient profile' })
  @ApiBody({ type: UpdatePatientDto })
  @ApiResponse({ status: 200, description: 'Patient profile updated successfully' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async updatePatient(
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const role = req.user?.role;
    const clinicId = req.clinicContext?.clinicId;
    const updates: Record<string, unknown> = {};

    if (role !== Role.PATIENT && clinicId) {
      const inClinic = await this.patientsService.isPatientInClinic(id, clinicId);
      if (!inClinic) {
        throw new ForbiddenException('Patient does not belong to your clinic');
      }
    }

    // Registration-desk demographics are administrative (not clinical), so every
    // staff role allowed on this route may update them.
    if (dto.address != null) updates['address'] = dto.address;
    if (dto.area != null) updates['area'] = dto.area;
    if (dto.district != null) updates['district'] = dto.district;
    if (dto.occupation != null) updates['occupation'] = dto.occupation;
    if (dto.maritalStatus != null) updates['maritalStatus'] = dto.maritalStatus;
    if (dto.organization != null) updates['organization'] = dto.organization;

    if (role === Role.RECEPTIONIST) {
      if (dto.emergencyContact != null) updates['emergencyContact'] = dto.emergencyContact;
      if (dto.insurance != null) updates['insurance'] = dto.insurance;
      if (Object.keys(updates).length === 0) {
        throw new ForbiddenException(
          'Receptionist can only update demographics, emergency contact and insurance information'
        );
      }
    } else {
      if (dto.dateOfBirth != null) updates['dateOfBirth'] = dto.dateOfBirth;
      if (dto.gender != null) updates['gender'] = dto.gender;
      if (dto.bloodGroup != null) updates['bloodGroup'] = dto.bloodGroup;
      if (dto.height != null) updates['height'] = dto.height;
      if (dto.weight != null) updates['weight'] = dto.weight;
      if (dto.allergies != null) updates['allergies'] = dto.allergies;
      if (dto.medicalHistory != null) updates['medicalHistory'] = dto.medicalHistory;
      if (dto.emergencyContact != null) updates['emergencyContact'] = dto.emergencyContact;
      if (dto.insurance != null) updates['insurance'] = dto.insurance;
    }

    return this.patientsService.updatePatient(id, updates);
  }

  @Delete(':id')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('patients', 'delete')
  @ApiOperation({ summary: 'Delete (Soft Delete) patient profile' })
  @ApiResponse({ status: 200, description: 'Patient deleted successfully' })
  @ApiResponse({ status: 404, description: 'Patient not found' })
  async deletePatient(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Validate patient belongs to requesting clinic
    const clinicId = req.clinicContext?.clinicId;
    if (clinicId) {
      const inClinic = await this.patientsService.isPatientInClinic(id, clinicId);
      if (!inClinic) {
        throw new ForbiddenException('Patient does not belong to your clinic');
      }
    }
    return this.patientsService.deletePatient(id);
  }
}
