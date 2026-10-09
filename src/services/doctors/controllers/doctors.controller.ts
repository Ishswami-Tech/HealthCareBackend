import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
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
import { LongCache } from '@core/decorators/cache.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import {
  CreateDoctorDto,
  UpdateDoctorProfileDto,
  DoctorProfileFieldsDto,
  CreateDoctorReviewDto,
  DoctorReviewsQueryDto,
} from '@dtos/doctor.dto';
import { buildDoctorProfileUpdate, type DoctorProfileFieldsInput } from '../doctors.service';

/** Extracts only the extended profile fields that were actually sent. */
function pickExtendedFields(dto: DoctorProfileFieldsDto): DoctorProfileFieldsInput {
  const out: Record<string, unknown> = {};
  for (const key of [
    'videoConsultationFee',
    'slotDurationMinutes',
    'videoConsultationEnabled',
    'inPersonConsultationEnabled',
    'licenseNumber',
    'languages',
    'education',
    'certifications',
    'localizedProfile',
  ] as const) {
    if (dto[key] !== undefined) out[key] = dto[key];
  }
  return out as DoctorProfileFieldsInput;
}

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
    // 🔒 TENANT ISOLATION: Always use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new Error('Clinic context is required');
    }

    return this.doctorsService.onboardDoctor(
      { role: req.user?.role ?? '', clinicId },
      {
        userId: dto.userId,
        clinicId,
        ...(dto.specialization != null && { specialization: dto.specialization }),
        ...(dto.experience != null && { experience: dto.experience }),
        ...(dto.qualification != null && { qualification: dto.qualification }),
        ...(dto.consultationFee != null && { consultationFee: dto.consultationFee }),
        ...(dto.workingHours != null && { workingHours: dto.workingHours }),
        ...pickExtendedFields(dto),
      }
    );
  }

  @Patch(':id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update doctor profile (fees, slot length, toggles, licence, languages, ...)',
    description:
      'id is the doctor User id. A DOCTOR edits only their own profile; a CLINIC_ADMIN only doctors of their clinic.',
  })
  @ApiBody({ type: UpdateDoctorProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated; returns the refreshed profile' })
  @ApiResponse({ status: 403, description: 'Not allowed to edit this profile' })
  @ApiResponse({ status: 404, description: 'Doctor not found in this clinic' })
  async updateDoctor(
    @Param('id') id: string,
    @Body() dto: UpdateDoctorProfileDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const actorId = req.user?.id || req.user?.sub;
    const role = req.user?.role;
    if (!actorId || !role) {
      throw new ForbiddenException('Authenticated user is required');
    }
    const clinicId = req.clinicContext?.clinicId ?? req.user?.clinicId;
    return this.doctorsService.updateDoctorProfile(
      id,
      { userId: actorId, role, clinicId },
      buildDoctorProfileUpdate({
        ...pickExtendedFields(dto),
        ...(dto.specialization != null && { specialization: dto.specialization }),
        ...(dto.experience != null && { experience: dto.experience }),
        ...(dto.qualification != null && { qualification: dto.qualification }),
        ...(dto.consultationFee != null && { consultationFee: dto.consultationFee }),
        ...(dto.workingHours != null && { workingHours: dto.workingHours }),
      })
    );
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
  @ApiOperation({ summary: 'Get all doctors (scoped to current clinic)' })
  @ApiQuery({ name: 'specialization', required: false })
  @ApiResponse({ status: 200, description: 'List of doctors retrieved successfully' })
  async getAllDoctors(
    @Query('specialization') specialization?: string,
    @Query('locationId') locationId?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Always use validated clinicId from guard context
    const clinicId = req?.clinicContext?.clinicId;
    return this.doctorsService.getAllDoctors({
      ...(specialization != null && { specialization }),
      ...(clinicId != null && { clinicId }),
      ...(locationId != null && { locationId }),
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
  // Tagged like the service-level profile cache (`doctor:<id>`, `user:<id>`), so
  // DoctorsService.createOrUpdateDoctor and any user-profile update reach this entry.
  // `long-cache` alone is invalidated by nothing, which left the profile stale for 24h.
  @LongCache(86400, ['doctor:{id}', 'user:{id}'])
  async getDoctor(@Param('id') id: string) {
    return this.doctorsService.getDoctorProfile(id);
  }

  @Get(':id/reviews')
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @ApiOperation({ summary: 'List reviews for a doctor (clinic-scoped, paginated)' })
  @ApiResponse({ status: 200, description: 'Reviews with average rating and count' })
  async listReviews(
    @Param('id') id: string,
    @Query() query: DoctorReviewsQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.doctorsService.listDoctorReviews(
      id,
      this.requireClinicId(req),
      query.page,
      query.limit
    );
  }

  @Post(':id/reviews')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Review a doctor after a completed appointment (one per appointment)' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({ status: 409, description: 'Appointment already reviewed' })
  async createReview(
    @Param('id') id: string,
    @Body() dto: CreateDoctorReviewDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const userId = req.user?.id || req.user?.sub;
    if (!userId) throw new ForbiddenException('Authenticated user is required');
    return this.doctorsService.createDoctorReview(id, this.requireClinicId(req), userId, {
      appointmentId: dto.appointmentId,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  private requireClinicId(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    return clinicId;
  }
}
