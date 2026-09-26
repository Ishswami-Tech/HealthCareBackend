/**
 * Visit Diet Chart Controller — Take / Avoid / Occasional chart per visit.
 *
 * Shares the `patient-visits` route prefix:
 *   GET    patient-visits/:visitId/diet-chart
 *   PUT    patient-visits/:visitId/diet-chart
 *   GET    patient-visits/diet-chart-foods?q=&group=&limit=
 *   POST   patient-visits/diet-chart-foods
 *   PATCH  patient-visits/diet-chart-foods/:foodId
 *
 * The static `diet-chart-foods` segment never collides with the sibling
 * `GET patient-visits/:visitId` route: Fastify's router prefers static
 * segments over parametric ones regardless of registration order.
 */

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
  CreateDietChartFoodDto,
  DietChartFoodSearchQueryDto,
  UpdateDietChartFoodDto,
  UpsertVisitDietChartDto,
} from '@dtos/visit-diet-chart.dto';
import type { DietChartFoodResponse, VisitDietChartResponse } from '@dtos/visit-diet-chart.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';
import { VisitDietChartService } from '@services/patient-visits/services/visit-diet-chart.service';

const DIET_READ_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];
const DIET_WRITE_ROLES: Role[] = [
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.CLINIC_ADMIN,
  Role.SUPER_ADMIN,
];

@ApiTags('patient-visits')
@Controller('patient-visits')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class VisitDietChartController {
  constructor(private readonly dietChartService: VisitDietChartService) {}

  // ===== Food master (static segment; declared before the :visitId routes) =

  @Get('diet-chart-foods')
  @Roles(...DIET_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({
    summary: 'Search the diet-chart food master (system rows + this clinic) in en/gu/hi/mr',
  })
  async searchFoods(
    @Query() query: DietChartFoodSearchQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DietChartFoodResponse[]> {
    return this.dietChartService.searchFoods(
      this.requireClinic(req),
      query.q,
      query.group,
      query.limit
    );
  }

  @Post('diet-chart-foods')
  @Roles(...DIET_WRITE_ROLES)
  @RequireResourcePermission('ehr', 'update')
  @ApiOperation({ summary: 'Add a clinic-specific food to the diet-chart picker' })
  async createFood(
    @Body() dto: CreateDietChartFoodDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DietChartFoodResponse> {
    return this.dietChartService.createFood(this.requireClinic(req), dto, this.actor(req));
  }

  @Patch('diet-chart-foods/:foodId')
  @Roles(...DIET_WRITE_ROLES)
  @RequireResourcePermission('ehr', 'update')
  @ApiOperation({ summary: 'Edit a clinic-specific food (system seed rows are read-only)' })
  async updateFood(
    @Param('foodId') foodId: string,
    @Body() dto: UpdateDietChartFoodDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DietChartFoodResponse> {
    return this.dietChartService.updateFood(foodId, this.requireClinic(req), dto, this.actor(req));
  }

  // ===== Per-visit chart ===================================================

  @Get(':visitId/diet-chart')
  @Roles(...DIET_READ_ROLES)
  @RequireResourcePermission('ehr', 'read')
  @ApiOperation({ summary: 'Diet chart for a visit (empty chart when none has been saved yet)' })
  async getChart(
    @Param('visitId') visitId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitDietChartResponse> {
    return this.dietChartService.getChartForVisit(visitId, this.requireClinic(req));
  }

  @Put(':visitId/diet-chart')
  @Roles(...DIET_WRITE_ROLES)
  @RequireResourcePermission('ehr', 'update')
  @ApiOperation({ summary: 'Save the diet chart for a visit (full replace of items)' })
  async upsertChart(
    @Param('visitId') visitId: string,
    @Body() dto: UpsertVisitDietChartDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<VisitDietChartResponse> {
    return this.dietChartService.upsertChartForVisit(
      visitId,
      this.requireClinic(req),
      dto,
      this.actor(req)
    );
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
