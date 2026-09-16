/**
 * Ward Controller
 * @module IPD Ward Controller
 * @description REST controller for ward management operations
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Body,
} from '@nestjs/common';
import type { CreateWardDto, UpdateWardDto, WardResponseDto } from '@services/ipd/dto';
import { WardService } from '@services/ipd/services/ward.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

/**
 * Controller for ward management operations.
 *
 * Provides endpoints for:
 * - Ward creation and updates
 * - Ward listing
 * - Ward statistics
 *
 * @public
 */
@Controller('ipd')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class WardController {
  /**
   * Creates an instance of WardController.
   * @param wardService - Ward management operations
   */
  constructor(private readonly wardService: WardService) {}

  /**
   * Creates a new ward.
   * POST /ipd/wards
   */
  @Post('wards')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async createWard(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateWardDto
  ): Promise<WardResponseDto> {
    return this.wardService.createWard(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Retrieves all wards for the clinic.
   * GET /ipd/wards
   */
  @Get('wards')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getAllWards(@Request() req: ClinicAuthenticatedRequest): Promise<WardResponseDto[]> {
    return this.wardService.getAllWards(
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Retrieves ward statistics including bed counts.
   * GET /ipd/ward-statistics
   */
  @Get('ward-statistics')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getWardStatistics(@Request() req: ClinicAuthenticatedRequest): Promise<WardResponseDto[]> {
    return this.wardService.getWardStatistics(
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Updates a ward.
   * PATCH /ipd/wards/:id
   */
  @Patch('wards/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async updateWard(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: UpdateWardDto
  ): Promise<WardResponseDto> {
    return this.wardService.updateWard(
      id,
      dto,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }
}
