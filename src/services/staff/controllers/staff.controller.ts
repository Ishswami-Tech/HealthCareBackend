import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StaffService } from '../staff.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

@ApiTags('staff')
@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update staff profile' })
  async createStaff(
    @Body() body: Record<string, unknown>,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    const userId = body['userId'] as string;

    const payload = {
      ...body,
      userId,
      clinicId,
    };

    return this.staffService.createOrUpdateStaff(
      payload as unknown as {
        userId: string;
        role: 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'NURSE';
        clinicId?: string;
        department?: string;
        employeeId?: string;
      }
    );
  }

  @Get()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all staff members (Receptionists, Nurses, Clinic Admins)' })
  async findAll(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    return this.staffService.getAllStaff({ clinicId: clinicId || undefined });
  }

  @Get(':id')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST, Role.NURSE)
  @ApiOperation({ summary: 'Get staff profile by ID (User ID)' })
  async getStaff(@Param('id') id: string) {
    return this.staffService.getStaffProfile(id);
  }
}
