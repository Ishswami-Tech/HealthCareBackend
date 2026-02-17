import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody, ApiResponse } from '@nestjs/swagger';
import { StaffService } from '../staff.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { CreateStaffDto } from '@dtos/staff.dto';

@ApiTags('staff')
@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@ApiBearerAuth()
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create or update staff profile' })
  @ApiBody({ type: CreateStaffDto })
  @ApiResponse({ status: 201, description: 'Staff profile created/updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - Validation failed' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async createStaff(@Body() dto: CreateStaffDto, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Always use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new Error('Clinic context is required');
    }

    // Cast StaffRole enum to string literal union expected by service
    const role = dto.role as 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'NURSE';

    return this.staffService.createOrUpdateStaff({
      userId: dto.userId,
      role,
      clinicId,
      ...(dto.department != null && { department: dto.department }),
      ...(dto.employeeId != null && { employeeId: dto.employeeId }),
    });
  }

  @Get()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all staff members (Receptionists, Nurses, Clinic Admins)' })
  @ApiResponse({ status: 200, description: 'List of staff retrieved successfully' })
  async findAll(@Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Require clinicId from validated guard context
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new Error('Clinic context is required to list staff');
    }
    return this.staffService.getAllStaff({ clinicId });
  }

  @Get(':id')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST, Role.NURSE)
  @ApiOperation({ summary: 'Get staff profile by ID (User ID)' })
  @ApiResponse({ status: 200, description: 'Staff profile retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Staff member not found' })
  async getStaff(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Pass clinicId for membership validation
    const clinicId = req.clinicContext?.clinicId;
    return this.staffService.getStaffProfile(id, clinicId);
  }
}
