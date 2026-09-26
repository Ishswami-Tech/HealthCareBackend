import {
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
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CreateFamilyMemberDto, UpdateFamilyMemberDto } from '@dtos/family-member.dto';
import type { FamilyMemberResponse } from '@dtos/family-member.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import { FamilyMembersService } from '@services/patient-visits/services/family-members.service';

const FAMILY_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('family-members')
@Controller('family-members')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class FamilyMembersController {
  constructor(private readonly familyMembersService: FamilyMembersService) {}

  @Post()
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'create')
  @ApiOperation({ summary: 'Register a dependent under a head-of-family patient' })
  async createFamilyMember(
    @Body() dto: CreateFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    return this.familyMembersService.createFamilyMember(
      dto,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Get('patient/:patientId')
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'List active dependents for a head-of-family patient' })
  async listFamilyMembers(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse[]> {
    return this.familyMembersService.listFamilyMembers(patientId, this.requireClinic(req));
  }

  @Patch(':id')
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'update')
  async updateFamilyMember(
    @Param('id') id: string,
    @Body() dto: UpdateFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    return this.familyMembersService.updateFamilyMember(
      id,
      dto,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Delete(':id')
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink a dependent (soft delete; clinical records are kept)' })
  async deleteFamilyMember(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<void> {
    await this.familyMembersService.deleteFamilyMember(
      id,
      this.requireClinic(req),
      this.actor(req)
    );
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
