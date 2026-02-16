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
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { PatientsService } from '../patients.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreatePatientDto, UpdatePatientDto } from '@dtos/patient.dto';

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

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
    const clinicId = dto.clinicId || req.clinicContext?.clinicId;

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
  @UseInterceptors(FileInterceptor('file'))
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
    @UploadedFile() file: MulterFile,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const userId = req.user?.id || req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }
    return await this.patientsService.uploadPatientDocument(patientId, file, {
      userId,
      userRole: req.user?.role || Role.PATIENT,
      operation: 'CREATE',
      resourceType: 'HEALTH_RECORD',
      clinicId: req.clinicContext?.clinicId || '',
    });
  }

  @Get(':id/insurance')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get patient insurance details' })
  @ApiResponse({ status: 200, description: 'Insurance details retrieved successfully' })
  async getInsurance(@Param('id') patientId: string) {
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
  @ApiResponse({ status: 200, description: 'List of patients retrieved successfully' })
  async findAll(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new BadRequestException('Clinic ID not found in context');
    }
    const doctorUserId =
      req.user?.role === Role.DOCTOR || req.user?.role === Role.ASSISTANT_DOCTOR
        ? (req.user?.id ?? req.user?.sub)
        : undefined;
    return this.patientsService.getClinicPatients(clinicId, undefined, doctorUserId);
  }

  @Get('clinic/:clinicId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Get all patients for a clinic' })
  @ApiQuery({ name: 'search', required: false })
  @ApiResponse({ status: 200, description: 'Clinic patients retrieved successfully' })
  async getClinicPatients(
    @Param('clinicId') clinicId: string,
    @Query('search') search: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const doctorUserId =
      req.user?.role === Role.DOCTOR || req.user?.role === Role.ASSISTANT_DOCTOR
        ? (req.user?.id ?? req.user?.sub)
        : undefined;
    return this.patientsService.getClinicPatients(clinicId, search, doctorUserId);
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
    const updates: Record<string, unknown> = {};
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
  async deletePatient(@Param('id') id: string) {
    return this.patientsService.deletePatient(id);
  }
}
