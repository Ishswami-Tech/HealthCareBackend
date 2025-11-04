import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EHRService } from '../ehr.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicEHRRecordFilters } from '@core/types/ehr.types';

@Controller('ehr/clinic')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EHRClinicController {
  constructor(private readonly ehrService: EHRService) {}

  // ============ Comprehensive Patient Records ============

  @Get('comprehensive/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getComprehensiveHealthRecordWithClinic(
    @Param('userId') userId: string,
    @Query('clinicId') clinicId: string
  ) {
    return this.ehrService.getComprehensiveHealthRecord(userId, clinicId);
  }

  // ============ Clinic-Wide EHR Access ============

  @Get(':clinicId/patients/records')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  async getClinicEHRAnalytics(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicEHRAnalytics(clinicId);
  }

  @Get(':clinicId/patients/summary')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.RECEPTIONIST)
  async getClinicPatientsSummary(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicPatientsSummary(clinicId);
  }

  @Get(':clinicId/search')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  async getClinicCriticalAlerts(@Param('clinicId') clinicId: string) {
    return this.ehrService.getClinicCriticalAlerts(clinicId);
  }
}
