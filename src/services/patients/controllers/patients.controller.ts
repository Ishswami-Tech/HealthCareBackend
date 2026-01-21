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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PatientsService } from '../patients.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

@ApiTags('patients')
@Controller('patients')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update patient profile' })
  async createPatient(
    @Body() body: Record<string, unknown>,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // Body should match what frontend sends: userId + profile fields
    const clinicId = req.clinicContext?.clinicId;
    const userId = body['userId'] as string;

    // Construct payload
    const payload = {
      ...body,
      userId,
      clinicId,
    };

    // Safe spread of unknown object into target type via unknown cast
    return this.patientsService.createOrUpdatePatient(
      payload as unknown as {
        userId: string;
        clinicId?: string;
        dateOfBirth?: string;
        gender?: 'MALE' | 'FEMALE' | 'OTHER';
        bloodGroup?: string;
        height?: number;
        weight?: number;
        allergies?: string[];
        medicalHistory?: string[];
        emergencyContact?: {
          name: string;
          relationship: string;
          phone: string;
        };
        insurance?: {
          provider: string;
          policyNumber: string;
          groupNumber?: string;
        };
      }
    );
  }

  @Get()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get all patients for the current clinic' })
  async findAll(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new Error('Clinic ID not found in context');
    }
    return this.patientsService.getClinicPatients(clinicId);
  }

  @Get('clinic/:clinicId')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all patients for a clinic' })
  @ApiQuery({ name: 'search', required: false })
  async getClinicPatients(@Param('clinicId') clinicId: string, @Query('search') search?: string) {
    return this.patientsService.getClinicPatients(clinicId, search);
  }

  @Get(':id')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.PATIENT)
  @ApiOperation({ summary: 'Get patient profile by ID (User ID)' })
  async getPatient(@Param('id') id: string) {
    return this.patientsService.getPatientProfile(id);
  }

  @Put(':id') // Using PUT or PATCH for update
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update patient profile' })
  async updatePatient(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.patientsService.updatePatient(id, body);
  }

  @Delete(':id')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete (Soft Delete) patient profile' })
  async deletePatient(@Param('id') id: string) {
    return this.patientsService.deletePatient(id);
  }
}
