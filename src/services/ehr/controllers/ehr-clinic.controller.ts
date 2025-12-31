import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EHRService } from '@services/ehr/ehr.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { PatientCache, Cache } from '@core/decorators';
import { Role } from '@core/types/enums.types';
import type { ClinicEHRRecordFilters } from '@core/types/ehr.types';

@ApiTags('ehr')
@Controller('ehr/clinic')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class EHRClinicController {
  constructor(private readonly ehrService: EHRService) {}

  // ============ Comprehensive Patient Records ============

  @Get('comprehensive/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:clinic:comprehensive:{userId}:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'clinic_ehr', 'user:{userId}', 'clinic:{clinicId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getComprehensiveHealthRecordWithClinic(
    @Param('userId') userId: string,
    @Query('clinicId') clinicId: string
  ) {
    return this.ehrService.getComprehensiveHealthRecord(userId, clinicId);
  }

  // ============ Clinic-Wide EHR Access ============

  @Get(':clinicId/patients/records')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate:
      'ehr:clinic:{clinicId}:patients:records:{recordType}:{hasCondition}:{hasAllergy}:{onMedication}:{dateFrom}:{dateTo}',
    ttl: 900, // 15 minutes
    tags: ['ehr', 'clinic_ehr', 'clinic:{clinicId}', 'patient_records'],
    enableSWR: true,
  })
  async getClinicPatientsRecords(
    @Param('clinicId') clinicId: string,
    @Query('recordType') recordType?: string,
    @Query('hasCondition') hasCondition?: string,
    @Query('hasAllergy') hasAllergy?: string,
    @Query('onMedication') onMedication?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string
  ) {
    const filters: ClinicEHRRecordFilters = {};
    if (recordType) filters.recordType = recordType;
    if (hasCondition) filters.hasCondition = hasCondition;
    if (hasAllergy) filters.hasAllergy = hasAllergy;
    if (onMedication) filters.onMedication = onMedication;
    if (dateFrom) filters.dateFrom = new Date(dateFrom);
    if (dateTo) filters.dateTo = new Date(dateTo);

    return this.ehrService.getClinicPatientsRecords(
      clinicId,
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
    tags: ['ehr', 'clinic_ehr', 'analytics', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  async getClinicEHRAnalytics(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicEHRAnalytics(clinicId);
  }

  @Get(':clinicId/patients/summary')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST)
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:patients:summary',
    ttl: 900, // 15 minutes
    tags: ['ehr', 'clinic_ehr', 'clinic:{clinicId}', 'patient_summary'],
    enableSWR: true,
  })
  async getClinicPatientsSummary(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicPatientsSummary(clinicId);
  }

  @Get(':clinicId/search')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:search:{q}:{types}',
    ttl: 300, // 5 minutes (search results may change)
    tags: ['ehr', 'clinic_ehr', 'clinic:{clinicId}', 'search'],
    enableSWR: true,
  })
  async searchClinicRecords(
    @Param('clinicId') clinicId: string,
    @Query('q') searchTerm: string,
    @Query('types') types?: string
  ) {
    const searchTypes = types ? types.split(',') : undefined;
    return this.ehrService.searchClinicRecords(clinicId, searchTerm, searchTypes);
  }

  @Get(':clinicId/alerts/critical')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST)
  @RequireResourcePermission('ehr', 'read')
  @Cache({
    keyTemplate: 'ehr:clinic:{clinicId}:alerts:critical',
    ttl: 60, // 1 minute (critical alerts change frequently)
    tags: ['ehr', 'clinic_ehr', 'clinic:{clinicId}', 'alerts'],
    enableSWR: true,
  })
  async getClinicCriticalAlerts(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicCriticalAlerts(clinicId);
  }
}
