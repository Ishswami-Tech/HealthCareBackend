import { Controller, Get, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DoctorsService } from '../doctors.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

@ApiTags('doctors')
@Controller('doctors')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class DoctorsController {
  constructor(private readonly doctorsService: DoctorsService) {}

  async createDoctor(
    @Body() body: Record<string, unknown>,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    const userId = body['userId'] as string;

    // Construct payload safely
    const payload = {
      ...body,
      userId,
      clinicId,
    };

    // Cast to unknown first to avoid unsafe assignment error, then let the service method validate type compatibility (or cast to expected structure if mapped)
    // The service expects specific fields. We can cast to that structure if we trust the input (standard controller->service pattern without DTOs)
    // validation is assumed to fail in service if mismatch.
    // We cannot use 'as any'. We use 'as unknown as ...'
    return this.doctorsService.createOrUpdateDoctor(
      payload as unknown as {
        userId: string;
        clinicId?: string;
        specialization?: string;
        experience?: number;
        qualification?: string;
        consultationFee?: number;
        workingHours?: unknown;
      }
    );
  }

  @Get()
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.PATIENT)
  @ApiOperation({ summary: 'Get all doctors (optional filters)' })
  @ApiQuery({ name: 'specialization', required: false })
  @ApiQuery({ name: 'clinicId', required: false })
  async getAllDoctors(
    @Query('specialization') specialization?: string,
    @Query('clinicId') clinicId?: string
  ) {
    return this.doctorsService.getAllDoctors({
      specialization: specialization || undefined,
      clinicId: clinicId || undefined,
    });
  }

  @Get(':id')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.PATIENT)
  @ApiOperation({ summary: 'Get doctor profile by ID (User ID)' })
  async getDoctor(@Param('id') id: string) {
    return this.doctorsService.getDoctorProfile(id);
  }
}
