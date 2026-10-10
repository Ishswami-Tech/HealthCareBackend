import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import type {
  PatientDirectoryFacets,
  PatientDirectoryPage,
  PatientDirectoryRow,
} from '@core/types/patient-directory.types';
import { complianceErrors } from '@services/compliance/utils/compliance-errors.util';
import { PatientDirectoryQueryDto } from './dto/patient-directory-query.dto';
import { PatientDirectoryService } from './patient-directory.service';
import type { DirectoryActor } from './patient-directory.service';

const STAFF_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.RECEPTIONIST,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('patients')
@ApiBearerAuth()
@Controller('patient-directory')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class PatientDirectoryController {
  constructor(private readonly directory: PatientDirectoryService) {}

  @Get()
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({
    summary: 'Search and filter the clinic patient list (page sizes 10, 50, 200, 500)',
  })
  async search(
    @Query() query: PatientDirectoryQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDirectoryPage> {
    return this.directory.search(this.clinicId(req), query, this.actor(req));
  }

  @Get('facets')
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'Cities, states, reference sources and case years to filter by' })
  async facets(@Request() req: ClinicAuthenticatedRequest): Promise<PatientDirectoryFacets> {
    return this.directory.facets(this.clinicId(req));
  }

  @Get(':patientId')
  @Roles(...STAFF_ROLES)
  @RequireResourcePermission('patients', 'read')
  @ApiOperation({ summary: 'One patient with UHID, contact and visit summary (EHR header)' })
  async findOne(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PatientDirectoryRow> {
    return this.directory.findOne(this.clinicId(req), patientId, this.actor(req));
  }

  private clinicId(req: ClinicAuthenticatedRequest): string {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) {
      throw complianceErrors.clinicContextRequired();
    }
    return clinicId;
  }

  private actor(req: ClinicAuthenticatedRequest): DirectoryActor {
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
