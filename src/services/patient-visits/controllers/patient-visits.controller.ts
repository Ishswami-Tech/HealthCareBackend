import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
  CreatePatientVisitDto,
  UpdatePatientVisitDto,
  UpsertVisitVitalsExaminationDto,
} from '@dtos/patient-visit.dto';
import type { PatientVisitResponse, VisitVitalsExaminationResponse } from '@dtos/patient-visit.dto';
import { UpsertClassicalExamFindingsDto } from '@services/ayurveda/dto/classical-exam.dto';
import type { ClassicalExamFindingResponse } from '@services/ayurveda/dto/classical-exam.dto';
import { ClassicalExamService } from '@services/ayurveda/services/classical-exam.service';
import {
  PatientVisitsService,
  type VisitActor,
  type VisitCaseSheetResponse,
} from '@services/patient-visits/patient-visits.service';
import { VisitVitalsExaminationService } from '@services/patient-visits/services/visit-vitals-examination.service';

const REGISTRATION_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const CLINICAL_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const VITALS_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('patient-visits')
@Controller('patient-visits')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class PatientVisitsController {
  constructor(
    private readonly visitsService: PatientVisitsService,
    private readonly vitalsService: VisitVitalsExaminationService,
    private readonly classicalExamService: ClassicalExamService
  ) {}

  @Post()
  @Roles(...REGISTRATION_ROLES)
  @RequireResourcePermission('patients', 'create')
  @ApiOperation({ summary: 'Register an OPD visit (allocates the OPD number)' })
  async createVisit(
    @Body() dto: CreatePatientVisitDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientVisitResponse> {
    return this.visitsService.createVisit(dto, this.requireClinic(req), this.actor(req));
  }

  @Get('patient/:patientId')
  @Roles(...REGISTRATION_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'List visits for a patient, most recent first' })
  async listVisitsForPatient(
    @Param('patientId') patientId: string,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ visits: PatientVisitResponse[]; total: number }> {
    return this.visitsService.listVisitsForPatient(patientId, this.requireClinic(req), {
      ...(limit !== undefined ? { limit: Number.parseInt(limit, 10) } : {}),
      ...(offset !== undefined ? { offset: Number.parseInt(offset, 10) } : {}),
    });
  }

  @Get(':visitId')
  @Roles(...REGISTRATION_ROLES)
  @RequireResourcePermission('patients', 'read')
  async getVisit(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientVisitResponse> {
    return this.visitsService.getVisitById(visitId, this.requireClinic(req));
  }

  @Patch(':visitId')
  @Roles(...REGISTRATION_ROLES)
  @RequireResourcePermission('patients', 'update')
  async updateVisit(
    @Param('visitId') visitId: string,
    @Body() dto: UpdatePatientVisitDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientVisitResponse> {
    return this.visitsService.updateVisit(visitId, this.requireClinic(req), dto, this.actor(req));
  }

  // Not cached on purpose: the case-sheet is edited continuously during a
  // consultation. (If caching is ever added here, the keyTemplate must use
  // {visitId} only — never {userId}, which the cache interceptor auto-fills
  // from the caller's own identity when the route has no :userId param.)
  @Get(':visitId/case-sheet')
  @Roles(...REGISTRATION_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Aggregate everything the case-sheet screen needs for one visit' })
  async getCaseSheet(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitCaseSheetResponse> {
    return this.visitsService.getCaseSheet(visitId, this.requireClinic(req));
  }

  @Put(':visitId/vitals-examination')
  @Roles(...VITALS_ROLES)
  @RequireResourcePermission('vitals', 'update')
  @ApiOperation({ summary: 'Save General Examination + Physical Measurement for a visit' })
  async upsertVitalsExamination(
    @Param('visitId') visitId: string,
    @Body() dto: UpsertVisitVitalsExaminationDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitVitalsExaminationResponse> {
    return this.vitalsService.upsertForVisit(
      visitId,
      this.requireClinic(req),
      dto,
      this.actor(req).userId
    );
  }

  @Get(':visitId/vitals-examination')
  @Roles(...VITALS_ROLES)
  @RequireResourcePermission('vitals', 'read')
  async getVitalsExamination(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitVitalsExaminationResponse | null> {
    return this.vitalsService.getForVisit(visitId, this.requireClinic(req));
  }

  @Put(':visitId/classical-exams')
  @Roles(...CLINICAL_ROLES)
  @RequireResourcePermission('ehr', 'update')
  @ApiOperation({
    summary:
      'Save classical exam findings (Ashtavidha/Dashavidha/Srotas/Samprapti Ghataka/Pain/Personal History) for a visit',
  })
  async upsertClassicalExams(
    @Param('visitId') visitId: string,
    @Body() dto: UpsertClassicalExamFindingsDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ClassicalExamFindingResponse[]> {
    return this.classicalExamService.upsertFindings(
      visitId,
      this.requireClinic(req),
      dto.findings,
      this.actor(req).userId
    );
  }

  @Get(':visitId/classical-exams')
  @Roles(...CLINICAL_ROLES, Role.NURSE)
  @RequireResourcePermission('ehr', 'read')
  async getClassicalExams(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ClassicalExamFindingResponse[]> {
    return this.classicalExamService.getFindingsForVisit(visitId, this.requireClinic(req));
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
