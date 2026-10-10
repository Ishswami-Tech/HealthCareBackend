import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
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
import type { PatientConsentRecord } from '@core/types/compliance.types';
import { RecordConsentDto } from '@services/compliance/dto/consent.dto';
import type { PatientConsentStateResponse } from '@services/compliance/dto/consent.dto';
import { ConsentService } from '@services/compliance/services/consent.service';
import type { ConsentActor } from '@services/compliance/services/consent.service';
import { complianceErrors } from '@services/compliance/utils/compliance-errors.util';

const STAFF_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('compliance')
@Controller('compliance/consents')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post()
  @Roles(...STAFF_ROLES, Role.PATIENT)
  @RequireResourcePermission('consent', 'create')
  @ApiOperation({ summary: 'Record a consent grant or withdrawal (append-only)' })
  async record(
    @Body() dto: RecordConsentDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientConsentRecord> {
    return this.consentService.record(dto, this.requireClinic(req), this.actor(req));
  }

  @Get('patient/:patientId')
  @Roles(...STAFF_ROLES, Role.PATIENT)
  @RequireResourcePermission('consent', 'read')
  @ApiOperation({ summary: 'Current consent per purpose plus full history' })
  async getForPatient(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientConsentStateResponse> {
    return this.consentService.getForPatient(patientId, this.requireClinic(req), this.actor(req));
  }

  private requireClinic(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw complianceErrors.clinicContextRequired();
    }
    return clinicId;
  }

  private actor(req: ClinicAuthenticatedRequest): ConsentActor {
    const userId = req.user?.sub;
    const role = req.user?.role;
    if (!userId || !role) {
      throw complianceErrors.forbidden('Authenticated user required');
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
