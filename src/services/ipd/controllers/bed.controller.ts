/**
 * Bed Controller
 * @module IPD Bed Controller
 * @description REST controller for bed board and bed management operations
 */

import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Body,
} from '@nestjs/common';
import type {
  BedBoardQueryDto,
  BedResponseDto,
  BedStatus,
  CreateBedDto,
  UpdateBedDto,
} from '@services/ipd/dto';
import { BedStatus as BedStatusEnum } from '@services/ipd/dto';
import { BedManagementService } from '@services/ipd/services/bed-management.service';
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
 * Controller for bed board and bed management operations.
 *
 * Provides endpoints for:
 * - Bed board view with filtering
 * - Bed creation and updates
 * - Bed status management
 * - Bed occupancy statistics
 *
 * @public
 */
@Controller('ipd')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class BedController {
  /**
   * Creates an instance of BedController.
   * @param bedManagementService - Bed board and availability operations
   * @param wardService - Ward management for bed creation context
   */
  constructor(
    private readonly bedManagementService: BedManagementService,
    private readonly wardService: WardService
  ) {}

  /**
   * Retrieves the bed board with optional filtering.
   * GET /ipd/beds?status=&wardId=&wardType=&page=&limit=
   */
  @Get('beds')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getBedBoard(
    @Query() query: BedBoardQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ data: BedResponseDto[]; total: number; page: number; limit: number }> {
    return this.bedManagementService.getBedBoard(
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string,
      query
    );
  }

  /**
   * Retrieves a specific bed by ID.
   * GET /ipd/beds/:id
   */
  @Get('beds/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getBed(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<BedResponseDto> {
    return this.bedManagementService.getBedById(
      id,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Updates the status of a bed.
   * PATCH /ipd/beds/:id/status?status=
   */
  @Patch('beds/:id/status')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async updateBedStatus(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('status') status: BedStatus
  ): Promise<BedResponseDto> {
    return this.bedManagementService.updateBedStatus(
      id,
      status,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Gets bed occupancy statistics.
   * GET /ipd/occupancy-stats
   */
  @Get('occupancy-stats')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getOccupancyStats(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ReturnType<typeof BedManagementService.prototype.getOccupancyStats>> {
    return this.bedManagementService.getOccupancyStats(
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Creates a new bed.
   * POST /ipd/beds
   */
  @Post('beds')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async createBed(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateBedDto
  ): Promise<ReturnType<typeof WardService.prototype.createBed>> {
    return this.wardService.createBed(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }

  /**
   * Updates bed details.
   * PATCH /ipd/beds/:id
   */
  @Patch('beds/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async updateBed(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: UpdateBedDto
  ): Promise<BedResponseDto> {
    return this.wardService.updateBed(
      id,
      dto,
      req.clinicContext?.clinicId as string,
      req.user?.locationId as string
    );
  }
}
