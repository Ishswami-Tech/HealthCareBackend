import { Controller, Get, Query, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { AnalyticsService, type AnalyticsQueryFilters } from './analytics.service';

@ApiTags('analytics')
@Controller('analytics')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Clinic-ID',
  description: 'Clinic identifier',
  required: true,
})
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get dashboard summary stats' })
  async getDashboardStats(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('period') period?: string
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getDashboardStats(clinicId, period);
  }

  @Get('appointments')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get appointment analytics' })
  async getAppointmentAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getAppointmentAnalytics(clinicId, filters);
  }

  @Get('patients')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get patient analytics' })
  async getPatientAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getPatientAnalytics(clinicId, filters);
  }

  @Get('revenue')
  @Roles(Role.CLINIC_ADMIN, Role.FINANCE_BILLING)
  @RequireResourcePermission('billing', 'read')
  @ApiOperation({ summary: 'Get revenue analytics' })
  async getRevenueAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getRevenueAnalytics(clinicId, filters);
  }

  @Get('clinics/performance')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get clinic performance analytics' })
  async getClinicPerformance(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('period') period?: string
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getClinicPerformance(clinicId, period);
  }

  @Get('services/utilization')
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get service utilization analytics' })
  async getServiceUtilization(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getServiceUtilization(clinicId, filters);
  }

  @Get('wait-times')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get wait time analytics' })
  async getWaitTimeAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getWaitTimeAnalytics(clinicId, filters);
  }

  @Get('satisfaction')
  @Roles(Role.CLINIC_ADMIN, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get patient satisfaction analytics' })
  async getSatisfactionAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getSatisfactionAnalytics(clinicId, filters);
  }

  @Get('queue')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: 'Get queue analytics' })
  async getQueueAnalytics(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() filters: AnalyticsQueryFilters = {}
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getQueueAnalytics(clinicId, filters);
  }
}
