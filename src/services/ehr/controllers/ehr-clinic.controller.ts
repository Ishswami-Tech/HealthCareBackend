import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EHRService } from '@services/ehr/ehr.service';
import { EHRWorkspaceService, type WorkspaceActor } from '@services/ehr/ehr-workspace.service';
import { PatientAppointmentsQueryDto, UpsertCarePlanDto } from '@dtos/ehr.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { PatientSelfAccessGuard } from '@core/guards/patient-self-access.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { PatientCache, Cache } from '@core/decorators';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import type { ClinicEHRRecordFilters } from '@core/types/ehr.types';

@ApiTags('ehr')
@Controller('ehr/clinic')
// PatientSelfAccessGuard: GET comprehensive/:userId is open to PATIENT, who must only be
// able to read their own (or an ACTIVE dependent's) record, not any user id.
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, PatientSelfAccessGuard)
export class EHRClinicController {
  constructor(
    private readonly ehrService: EHRService,
    private readonly workspaceService: EHRWorkspaceService
  ) {}

  /** Validated clinic of the caller; every workspace route is clinic-scoped (fail closed). */
  private requireClinicId(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    return clinicId;
  }

  private actorOf(req: ClinicAuthenticatedRequest): WorkspaceActor {
    return { userId: req.user?.id ?? req.user?.sub ?? '', role: req.user?.role };
  }

  // ============ Comprehensive Patient Records ============

  @Get('comprehensive/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:clinic:comprehensive:{userId}:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'user:{userId}', 'clinic:{clinicId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  @RateLimitAPI()
  async getComprehensiveHealthRecordWithClinic(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getComprehensiveHealthRecord(userId, clinicId);
  }

  // ============ Clinic-Wide EHR Access ============

  @Get(':clinicId/patients/records')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate:
      'ehr:clinic:{clinicId}:patients:records:{recordType}:{hasCondition}:{hasAllergy}:{onMedication}:{dateFrom}:{dateTo}',
    ttl: 900, // 15 minutes
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'clinic:{clinicId}', 'patient_records:{clinicId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getClinicPatientsRecords(
    @Param('clinicId') paramClinicId: string,
    @Query('recordType') recordType?: string,
    @Query('hasCondition') hasCondition?: string,
    @Query('hasAllergy') hasAllergy?: string,
    @Query('onMedication') onMedication?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const validatedClinicId = req?.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    // Reject URL manipulation attempts
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot access EHR records from a different clinic');
    }

    const filters: ClinicEHRRecordFilters = {};
    if (recordType) filters.recordType = recordType;
    if (hasCondition) filters.hasCondition = hasCondition;
    if (hasAllergy) filters.hasAllergy = hasAllergy;
    if (onMedication) filters.onMedication = onMedication;
    if (dateFrom) filters.dateFrom = new Date(dateFrom);
    if (dateTo) filters.dateTo = new Date(dateTo);

    return this.ehrService.getClinicPatientsRecords(
      validatedClinicId,
      'DOCTOR', // Default role for clinic access
      filters
    );
  }

  @Get(':clinicId/analytics')
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('reports', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:analytics',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'analytics', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  @RateLimitAPI()
  async getClinicEHRAnalytics(
    @Param('clinicId') paramClinicId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const validatedClinicId = req.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot access analytics from a different clinic');
    }
    return this.ehrService.getClinicEHRAnalytics(validatedClinicId);
  }

  @Get(':clinicId/patients/summary')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:patients:summary',
    ttl: 900, // 15 minutes
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'clinic:{clinicId}', 'patient_summary:{clinicId}'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async getClinicPatientsSummary(
    @Param('clinicId') paramClinicId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const validatedClinicId = req.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot access patient summary from a different clinic');
    }
    return this.ehrService.getClinicPatientsSummary(validatedClinicId);
  }

  @Get(':clinicId/search')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:search:{q}:{types}',
    ttl: 300, // 5 minutes (search results may change)
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'clinic:{clinicId}', 'search'],
    enableSWR: true,
    containsPHI: true,
  })
  @RateLimitAPI()
  async searchClinicRecords(
    @Param('clinicId') paramClinicId: string,
    @Query('q') searchTerm: string,
    @Query('types') types?: string,
    @Request() req?: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const validatedClinicId = req?.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot search records from a different clinic');
    }
    const searchTypes = types ? types.split(',') : undefined;
    return this.ehrService.searchClinicRecords(validatedClinicId, searchTerm, searchTypes);
  }

  @Get(':clinicId/alerts/critical')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST)
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:alerts:critical',
    ttl: 60, // 1 minute (critical alerts change frequently)
    tags: ['ehr', 'clinic_ehr:{clinicId}', 'clinic:{clinicId}', 'alerts:{clinicId}'],
    enableSWR: true,
    containsPHI: true,
  })
  async getClinicCriticalAlerts(
    @Param('clinicId') paramClinicId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const validatedClinicId = req.clinicContext?.clinicId;
    if (!validatedClinicId) {
      throw new ForbiddenException('Clinic context is required');
    }
    if (paramClinicId !== validatedClinicId) {
      throw new ForbiddenException('Cannot access alerts from a different clinic');
    }
    return this.ehrService.getClinicCriticalAlerts(validatedClinicId);
  }

  // ============ EHR Workspace (single patient) ============
  // Clinical staff of the caller's clinic only. `:patientId` is the Patient.id or the
  // User.id; a patient of another clinic is a 404 (no oracle). Reads are audited.

  @Get('patients/:patientId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read')
  @RateLimitAPI()
  async getWorkspacePatient(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.workspaceService.getWorkspacePatient(
      patientId,
      this.requireClinicId(req),
      this.actorOf(req)
    );
  }

  @Get('patients/:patientId/appointments')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read')
  @RateLimitAPI()
  async getPatientAppointments(
    @Param('patientId') patientId: string,
    @Query() query: PatientAppointmentsQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.workspaceService.listPatientAppointments(
      patientId,
      this.requireClinicId(req),
      this.actorOf(req),
      query
    );
  }

  // PATIENT may read their own care plan (PatientSelfAccessGuard rejects any other
  // `:patientId`); only doctors and clinic admins may change it.
  @Get('patients/:patientId/care-plan')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @RateLimitAPI()
  async getCarePlan(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.workspaceService.getCarePlan(
      patientId,
      this.requireClinicId(req),
      this.actorOf(req)
    );
  }

  @Put('patients/:patientId/care-plan')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'update')
  @RateLimitAPI()
  async upsertCarePlan(
    @Param('patientId') patientId: string,
    @Body() dto: UpsertCarePlanDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    return this.workspaceService.upsertCarePlan(
      patientId,
      this.requireClinicId(req),
      dto,
      this.actorOf(req)
    );
  }
}
