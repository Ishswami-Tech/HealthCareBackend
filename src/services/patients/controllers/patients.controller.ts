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
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreatePatientDto, UpdatePatientDto } from '@dtos/patient.dto';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PatientsService } from '../patients.service';

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
      | MultipartItem
      | Buffer
      | string
      | undefined;

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
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
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

    const patientRecord = await this.patientsService.getPatientRecordForClinic(patientId, clinicId);
    if (!patientRecord) {
      throw new ForbiddenException('Patient does not belong to your clinic');
    }

    const requestRole = (req.user?.role as Role | undefined) || Role.PATIENT;
    if (requestRole === Role.PATIENT && patientRecord.userId !== userId) {
      throw new ForbiddenException('You can only upload documents to your own record');
    }

    return await this.patientsService.uploadPatientDocument(patientId, file, {
      userId,
      userRole: req.user?.role || Role.PATIENT,
      operation: 'CREATE',
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

    return await this.patientsService.getInsurance(patientId);
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

    if (role === Role.RECEPTIONIST) {
      if (dto.emergencyContact != null) updates['emergencyContact'] = dto.emergencyContact;
      if (dto.insurance != null) updates['insurance'] = dto.insurance;
      if (Object.keys(updates).length === 0) {
        throw new ForbiddenException(
          'Receptionist can only update emergency contact and insurance information'
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
