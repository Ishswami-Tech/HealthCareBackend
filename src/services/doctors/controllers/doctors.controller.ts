import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { DoctorsService } from '../doctors.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreateDoctorDto } from '@dtos/doctor.dto';

@ApiTags('doctors')
@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  @Post()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update doctor profile' })
  @ApiBody({ type: CreateDoctorDto })
  @ApiResponse({ status: 201, description: 'Doctor profile created/updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Validation failed' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async createDoctor(@Body() dto: CreateDoctorDto, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = dto.clinicId || req.clinicContext?.clinicId;

    return this.doctorsService.createOrUpdateDoctor({
      userId: dto.userId,
      ...(clinicId != null && { clinicId }),
      ...(dto.specialization != null && { specialization: dto.specialization }),
      ...(dto.experience != null && { experience: dto.experience }),
      ...(dto.qualification != null && { qualification: dto.qualification }),
      ...(dto.consultationFee != null && { consultationFee: dto.consultationFee }),
      ...(dto.workingHours != null && { workingHours: dto.workingHours }),
    });
  }

  @Get()
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.PATIENT
  )
  @ApiOperation({ summary: 'Get all doctors (optional filters)' })
  @ApiQuery({ name: 'specialization', required: false })
  @ApiQuery({ name: 'clinicId', required: false })
  @ApiResponse({ status: 200, description: 'List of doctors retrieved successfully' })
  async getAllDoctors(
    @Query('specialization') specialization?: string,
    @Query('clinicId') clinicId?: string
  ) {
    return this.doctorsService.getAllDoctors({
      ...(specialization != null && { specialization }),
      ...(clinicId != null && { clinicId }),
    });
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
  @ApiOperation({ summary: 'Get doctor profile by ID (User ID)' })
  @ApiResponse({ status: 200, description: 'Doctor profile retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Doctor not found' })
  async getDoctor(@Param('id') id: string) {
    return this.doctorsService.getDoctorProfile(id);
  }
}
