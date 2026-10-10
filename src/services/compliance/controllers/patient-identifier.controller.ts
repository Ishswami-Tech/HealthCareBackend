import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
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
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import type { PatientIdentifierRecord } from '@core/types/compliance.types';
import {
  IssueUhidDto,
  LookupPatientIdentifierQueryDto,
  SetPatientIdentifierDto,
} from '@services/compliance/dto/patient-identifier.dto';
import type { PatientIdentifierLookupResponse } from '@services/compliance/dto/patient-identifier.dto';
import { PatientIdentifierService } from '@services/compliance/services/patient-identifier.service';
import type { IdentifierActor } from '@services/compliance/services/patient-identifier.service';
import { UhidAllocatorService } from '@services/compliance/services/uhid-allocator.service';

const STAFF_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('compliance')
@Controller('compliance/patient-identifiers')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class PatientIdentifierController {
  constructor(
    private readonly identifierService: PatientIdentifierService,
    private readonly uhidAllocator: UhidAllocatorService
  ) {}

  @Post('uhid')
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patient-identifiers', 'update')
  @ApiOperation({ summary: "Issue the patient's UHID (idempotent: returns the existing one)" })
  async issueUhid(
    @Body() dto: IssueUhidDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientIdentifierRecord> {
    return this.uhidAllocator.issueForActor(
      dto.patientId,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Post()
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patient-identifiers', 'update')
  @ApiOperation({ summary: 'Set a patient identifier (replaces the same system for that patient)' })
  async set(
    @Body() dto: SetPatientIdentifierDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientIdentifierRecord> {
    return this.identifierService.setIdentifierForActor(
      dto.patientId,
      dto.system,
      dto.value,
      this.requireClinic(req),
      this.actor(req)
    );
  }

  @Get('lookup')
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patient-identifiers', 'read')
  @ApiOperation({ summary: 'Find the patient holding an identifier in this clinic' })
  async lookup(
    @Query() query: LookupPatientIdentifierQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientIdentifierLookupResponse> {
    const patientId = await this.identifierService.lookupForActor(
      query.system,
      query.value,
      this.requireClinic(req),
      this.actor(req)
    );
    return { patientId };
  }

  @Get('patient/:patientId')
  @Roles(...STAFF_ROLES, Role.PATIENT)
  @RequireResourcePermission('patient-identifiers', 'read')
  @ApiOperation({ summary: "List a patient's identifiers in this clinic" })
  async listForPatient(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientIdentifierRecord[]> {
    return this.identifierService.listForActor(patientId, this.requireClinic(req), this.actor(req));
  }

  private requireClinic(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw new ForbiddenException('Clinic context required');
    }
    return clinicId;
  }

  private actor(req: ClinicAuthenticatedRequest): IdentifierActor {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw new ForbiddenException('Authenticated user required');
    }
    return {
      userId,
      role,
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(typeof req.headers['user-agent'] === 'string'
        ? { userAgent: req.headers['user-agent'] }
        : {}),
    };
  }
}
