/**
 * Visit Therapy Controller — Therapy / Panchakarma plans & sessions.
 *
 * Shares the `patient-visits` route prefix with PatientVisitsController
 * (NestJS allows several controllers per prefix). The static segments
 * (`therapy-plans`, `therapy-sessions`, `therapy`, `therapists`) never collide
 * with PatientVisitsController's `:visitId` routes in Fastify's router.
 *
 *   GET    patient-visits/:visitId/therapy-plans
 *   POST   patient-visits/:visitId/therapy-plans
 *   PATCH  patient-visits/therapy-plans/:planId
 *   POST   patient-visits/therapy-plans/:planId/sessions
 *   PATCH  patient-visits/therapy-sessions/:sessionId
 *   GET    patient-visits/patient/:patientId/therapy-progress
 *   GET    patient-visits/therapy/my-sessions?date=YYYY-MM-DD
 *   GET    patient-visits/therapists
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
  CreateVisitTherapyPlanDto,
  RecordTherapySessionDto,
  UpdateTherapySessionDto,
  UpdateVisitTherapyPlanDto,
} from '@dtos/visit-therapy.dto';
import type {
  TherapistOptionResponse,
  TherapyProgressResponse,
  TherapyWorkItemResponse,
  VisitTherapyPlanResponse,
  VisitTherapySessionResponse,
} from '@dtos/visit-therapy.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import { VisitTherapyService } from '@services/patient-visits/services/visit-therapy.service';

/** Anyone who reads a case-sheet's therapy tab. */
const THERAPY_READ_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
  Role.THERAPIST,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
/** Plans are authored by the treating doctor. */
const PLAN_WRITE_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
/** Sessions are recorded by whoever performed them. */
const SESSION_WRITE_ROLES: Role[] = [
  Role.THERAPIST,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const MY_SESSIONS_ROLES: Role[] = [Role.THERAPIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN];
const THERAPIST_PICKER_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('patient-visits')
@Controller('patient-visits')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class VisitTherapyController {
  constructor(private readonly therapyService: VisitTherapyService) {}

  @Get(':visitId/therapy-plans')
  @Roles(...THERAPY_READ_ROLES)
  @RequireResourcePermission('therapy', 'read')
  @ApiOperation({ summary: 'List therapy plans (with sessions) for a visit' })
  async listPlans(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitTherapyPlanResponse[]> {
    return this.therapyService.listPlansForVisit(visitId, this.requireClinic(req));
  }

  @Post(':visitId/therapy-plans')
  @Roles(...PLAN_WRITE_ROLES)
  @RequireResourcePermission('therapy', 'create')
  @ApiOperation({ summary: 'Plan a therapy / Panchakarma procedure for a visit' })
  async createPlan(
    @Param('visitId') visitId: string,
    @Body() dto: CreateVisitTherapyPlanDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitTherapyPlanResponse> {
    return this.therapyService.createPlan(visitId, this.requireClinic(req), dto, this.actor(req));
  }

  @Patch('therapy-plans/:planId')
  @Roles(...PLAN_WRITE_ROLES)
  @RequireResourcePermission('therapy', 'update')
  @ApiOperation({ summary: 'Update a therapy plan (details, therapist, pause/resume/cancel)' })
  async updatePlan(
    @Param('planId') planId: string,
    @Body() dto: UpdateVisitTherapyPlanDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitTherapyPlanResponse> {
    return this.therapyService.updatePlan(planId, this.requireClinic(req), dto, this.actor(req));
  }

  @Post('therapy-plans/:planId/sessions')
  @Roles(...SESSION_WRITE_ROLES)
  @RequireResourcePermission('therapy', 'update')
  @ApiOperation({ summary: 'Record a performed session (session number allocated atomically)' })
  async recordSession(
    @Param('planId') planId: string,
    @Body() dto: RecordTherapySessionDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitTherapyPlanResponse> {
    return this.therapyService.recordSession(planId, this.requireClinic(req), dto, this.actor(req));
  }

  @Patch('therapy-sessions/:sessionId')
  @Roles(...SESSION_WRITE_ROLES)
  @RequireResourcePermission('therapy', 'update')
  @ApiOperation({ summary: 'Correct a recorded session' })
  async updateSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateTherapySessionDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitTherapySessionResponse> {
    return this.therapyService.updateSession(
      sessionId,
      this.requireClinic(req),
      dto,
      this.actor(req)
    );
  }

  @Get('patient/:patientId/therapy-progress')
  @Roles(...THERAPY_READ_ROLES)
  @RequireResourcePermission('therapy', 'read')
  @ApiOperation({ summary: 'Therapy progress across all visits plus per-visit vitals trend' })
  async getPatientProgress(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<TherapyProgressResponse> {
    return this.therapyService.getPatientProgress(patientId, this.requireClinic(req));
  }

  @Get('therapy/my-sessions')
  @Roles(...MY_SESSIONS_ROLES)
  @RequireResourcePermission('therapy', 'read')
  @ApiOperation({ summary: "The signed-in therapist's open plans, optionally for one date" })
  async listMySessions(
    @Query('date') date: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<TherapyWorkItemResponse[]> {
    const { userId } = this.actor(req);
    if (!userId) {
      throw new ForbiddenException('Authenticated user required');
    }
    return this.therapyService.listMySessions(
      userId,
      this.requireClinic(req),
      date?.trim() ? date.trim() : undefined
    );
  }

  // RECEPTIONIST has patients:read but not therapy:read, and needs the picker
  // when registering a therapy visit — hence the patients permission here.
  @Get('therapists')
  @Roles(...THERAPIST_PICKER_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Therapists attached to the current clinic (assignment picker)' })
  async listTherapists(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<TherapistOptionResponse[]> {
    return this.therapyService.listTherapists(this.requireClinic(req));
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
