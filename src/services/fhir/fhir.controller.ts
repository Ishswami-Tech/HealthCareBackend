import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Request,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
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
import { FhirExceptionFilter } from '@services/fhir/fhir-exception.filter';
import { FHIR_JSON_CONTENT_TYPE } from '@services/fhir/fhir.constants';
import { FhirService } from '@services/fhir/fhir.service';
import type { FhirActor } from '@services/fhir/fhir.service';
import { truncateUserAgent } from '@services/fhir/fhir-request.util';
import type { RawQueryValue } from '@services/fhir/fhir-request.util';
import type {
  FhirAllergyIntolerance,
  FhirBundle,
  FhirCapabilityStatement,
  FhirCondition,
  FhirEncounter,
  FhirMedicationStatement,
  FhirObservation,
  FhirPatient,
} from '@services/fhir/fhir.types';

/** Clinical data: clinical staff, plus a PATIENT reading only their own record (service-enforced). */
const FHIR_READ_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
  Role.PATIENT,
];
const ANY_AUTHENTICATED_ROLE: Role[] = Object.values(Role);

/**
 * Read-only HL7 FHIR R4 endpoints. There is deliberately no POST/PUT/PATCH/DELETE here.
 * Every response is `application/fhir+json`; failures are OperationOutcome bodies.
 */
@ApiTags('fhir')
@Controller('fhir')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
@UseFilters(FhirExceptionFilter)
export class FhirController {
  constructor(private readonly fhirService: FhirService) {}

  @Get('metadata')
  @Roles(...ANY_AUTHENTICATED_ROLE)
  @ApiOperation({ summary: 'FHIR CapabilityStatement (read-only server)' })
  getMetadata(@Res({ passthrough: true }) reply: FastifyReply): FhirCapabilityStatement {
    this.asFhirJson(reply);
    return this.fhirService.getCapabilityStatement();
  }

  @Get('Patient/:id')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Read one Patient' })
  async readPatient(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirPatient> {
    this.asFhirJson(reply);
    return this.fhirService.getPatient(id, this.actor(req));
  }

  @Get('Patient/:id/$everything')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Patient $everything: all mapped resources for one patient' })
  async patientEverything(
    @Param('id') id: string,
    @Query('reason') reason: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle> {
    this.asFhirJson(reply);
    return this.fhirService.getEverything(id, this.actor(req), reason);
  }

  @Get('Encounter')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Search Encounters (OPD visits) by patient' })
  async searchEncounters(
    @Query('patient') patient: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle<FhirEncounter>> {
    this.asFhirJson(reply);
    return this.fhirService.searchEncounters(patient, this.actor(req));
  }

  @Get('Observation')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Search Observations (vitals, classical exam findings) by patient' })
  async searchObservations(
    @Query('patient') patient: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle<FhirObservation>> {
    this.asFhirJson(reply);
    return this.fhirService.searchObservations(patient, this.actor(req));
  }

  @Get('Condition')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Search Conditions (diagnoses) by patient' })
  async searchConditions(
    @Query('patient') patient: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle<FhirCondition>> {
    this.asFhirJson(reply);
    return this.fhirService.searchConditions(patient, this.actor(req));
  }

  @Get('AllergyIntolerance')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Search AllergyIntolerances by patient' })
  async searchAllergies(
    @Query('patient') patient: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle<FhirAllergyIntolerance>> {
    this.asFhirJson(reply);
    return this.fhirService.searchAllergies(patient, this.actor(req));
  }

  @Get('MedicationStatement')
  @Roles(...FHIR_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Search MedicationStatements by patient' })
  async searchMedicationStatements(
    @Query('patient') patient: RawQueryValue,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<FhirBundle<FhirMedicationStatement>> {
    this.asFhirJson(reply);
    return this.fhirService.searchMedicationStatements(patient, this.actor(req));
  }

  private asFhirJson(reply: FastifyReply): void {
    void reply.type(FHIR_JSON_CONTENT_TYPE);
  }

  private actor(req: ClinicAuthenticatedRequest): FhirActor {
    const clinicId = req.clinicContext?.clinicId;
    const userId = req.user?.sub ?? req.user?.id;
    if (!clinicId || !userId) {
      throw new ForbiddenException('Clinic context required');
    }
    const userAgent = truncateUserAgent(req.headers['user-agent']);
    return {
      userId,
      role: req.user?.role ?? '',
      clinicId,
      ...(req.ip ? { ipAddress: req.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }
}
