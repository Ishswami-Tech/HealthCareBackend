import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
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
import { DoctorEarningsQueryDto } from './dto/doctor-earnings-query.dto';
import { UpdateDoctorFeeSplitDto } from './dto/doctor-fee-split.dto';

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
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE)
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

  /**
   * The signed-in doctor's own earnings (paid consultations, per day). Always the caller's own
   * data: the doctor is resolved from the token, never from a parameter.
   */
  @Get('doctor/me/earnings')
  @Roles(Role.DOCTOR)
  @RequireResourcePermission('analytics', 'read')
  @ApiOperation({ summary: "Get the signed-in doctor's own earnings" })
  async getMyEarnings(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: DoctorEarningsQueryDto
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) throw new ForbiddenException('Authenticated user required');
    return await this.analyticsService.getDoctorOwnEarnings(userId, clinicId, query);
  }

  /**
   * How paid video consultations split between each doctor and the platform (convenience fee),
   * plus payments on visits that did not complete. Admins only - a doctor never sees the gross.
   */
  @Get('earnings/split')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'read')
  @ApiOperation({ summary: 'Earnings split report: doctor share vs convenience fee' })
  async getEarningsSplit(
    @Request() req: ClinicAuthenticatedRequest,
    @Query() query: DoctorEarningsQueryDto
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.getEarningsSplitReport(clinicId, query);
  }

  @Get('doctors/fee-split')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'read')
  @ApiOperation({ summary: "List the clinic's doctors with their fixed fees" })
  async listDoctorFeeSplits(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    return await this.analyticsService.listDoctorFeeSplits(clinicId);
  }

  /** Sets what a doctor earns per visit type in the caller's clinic; the rest is convenience fee. */
  @Put('doctors/:doctorId/fee-split')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('billing', 'update')
  @ApiOperation({ summary: "Set a doctor's fixed fee for video / in-person visits" })
  async updateDoctorFeeSplit(
    @Request() req: ClinicAuthenticatedRequest,
    @Param('doctorId', ParseUUIDPipe) doctorId: string,
    @Body() body: UpdateDoctorFeeSplitDto
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) throw new ForbiddenException('Authenticated user required');
    return await this.analyticsService.updateDoctorFeeSplit(
      clinicId,
      doctorId,
      { userId, role: String(req.user?.role ?? 'ADMIN') },
      body
    );
  }

  @Get('appointments')
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE)
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
  @Roles(Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE)
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
