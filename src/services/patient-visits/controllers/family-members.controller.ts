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
import {
  CreateFamilyMemberDto,
  CreateMyFamilyMemberDto,
  UpdateFamilyMemberDto,
} from '@dtos/family-member.dto';
import type { FamilyMemberResponse } from '@dtos/family-member.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import {
  FamilyMembersService,
  MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
  MAX_DEPENDENT_CREATIONS_PER_WINDOW,
} from '@services/patient-visits/services/family-members.service';

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

  // ── Patient self-service (head of family = the authenticated patient) ──────
  // Declared before the staff routes. Ownership is derived from the JWT user,
  // never from a client-supplied patient id.

  @Get('me')
  @Roles(Role.PATIENT)
  @RequireResourcePermission('profile', 'read')
  @ApiOperation({ summary: 'List my family members (patient self-service)' })
  async listMyFamilyMembers(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse[]> {
    const patientId = await this.familyMembersService.resolvePatientIdForUser(
      this.requireUserId(req)
    );
    return this.familyMembersService.listFamilyMembers(patientId);
  }

  @Post('me')
  @Roles(Role.PATIENT)
  @RequireResourcePermission('profile', 'update')
  @ApiOperation({ summary: 'Add a family member under my account (patient self-service)' })
  async createMyFamilyMember(
    @Body() dto: CreateMyFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    const patientId = await this.familyMembersService.resolvePatientIdForUser(
      this.requireUserId(req)
    );
    const payload: CreateFamilyMemberDto = { ...dto, primaryPatientId: patientId };
    // Self-service is capped so one account cannot mint unlimited User/Patient rows:
    // at most 10 ACTIVE dependents (409) and at most 20 creations per rolling 30 days,
    // removed dependents included (429). Counted and created under a per-patient lock.
    return this.familyMembersService.createFamilyMember(
      payload,
      this.requireClinic(req),
      this.actor(req),
      {
        maxActiveDependents: MAX_ACTIVE_DEPENDENTS_PER_PATIENT,
        maxRecentCreations: MAX_DEPENDENT_CREATIONS_PER_WINDOW,
      }
    );
  }

  @Patch('me/:id')
  @Roles(Role.PATIENT)
  @RequireResourcePermission('profile', 'update')
  @ApiOperation({ summary: 'Update one of my family members (patient self-service)' })
  async updateMyFamilyMember(
    @Param('id') id: string,
    @Body() dto: UpdateFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    const patientId = await this.familyMembersService.resolvePatientIdForUser(
      this.requireUserId(req)
    );
    await this.familyMembersService.assertOwnedByPatient(id, patientId);
    return this.familyMembersService.updateFamilyMember(
      id,
      dto,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Delete('me/:id')
  @Roles(Role.PATIENT)
  @RequireResourcePermission('profile', 'update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one of my family members (soft delete; patient self-service)' })
  async deleteMyFamilyMember(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<void> {
    const patientId = await this.familyMembersService.resolvePatientIdForUser(
      this.requireUserId(req)
    );
    await this.familyMembersService.assertOwnedByPatient(id, patientId);
    await this.familyMembersService.deleteFamilyMember(
      id,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  // ── Staff routes ──────────────────────────────────────────────────────────

  @Post()
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'create')
  @ApiOperation({ summary: 'Register a dependent under a head-of-family patient' })
  async createFamilyMember(
    @Body() dto: CreateFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    const clinicId = this.requireClinic(req);
    // Staff routes take the head of family from the body: it must be a patient of this clinic.
    await this.familyMembersService.assertPatientInClinic(dto.primaryPatientId, clinicId);
    return this.familyMembersService.createFamilyMember(dto, clinicId, this.actor(req));
  }

  @Get('patient/:patientId')
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'List active dependents for a head-of-family patient' })
  async listFamilyMembers(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse[]> {
    await this.familyMembersService.assertPatientInClinic(patientId, this.requireClinic(req));
    return this.familyMembersService.listFamilyMembers(patientId);
  }

  @Patch(':id')
  @Roles(...FAMILY_ROLES)
  @RequireResourcePermission('patients', 'update')
  async updateFamilyMember(
    @Param('id') id: string,
    @Body() dto: UpdateFamilyMemberDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyMemberResponse> {
    const clinicId = this.requireClinic(req);
    await this.familyMembersService.assertMemberInClinic(id, clinicId);
    return this.familyMembersService.updateFamilyMember(id, dto, clinicId, this.actor(req));
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
    const clinicId = this.requireClinic(req);
    await this.familyMembersService.assertMemberInClinic(id, clinicId);
    await this.familyMembersService.deleteFamilyMember(id, clinicId, this.actor(req));
  }

  private requireUserId(req: ClinicAuthenticatedRequest): string {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    return userId;
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
