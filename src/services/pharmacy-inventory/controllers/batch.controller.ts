/**
 * Batch Controller
 * @module Pharmacy Inventory
 * @description Stock batch/lot tracking and FEFO batch selection endpoints
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BatchService } from '../services/batch.service';
import { CreateStockBatchDto, BatchFilterDto } from '../dto/pharmacy-inventory.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

/**
 * Controller for pharmacy stock batch/lot tracking.
 *
 * Endpoints:
 * - POST /pharmacy/inventory/batches — receive new stock batch
 * - GET /pharmacy/inventory/batches — list batches with filters
 * - GET /pharmacy/inventory/batches/:id — get batch by ID
 * - GET /pharmacy/inventory/fefo/:productId — FEFO candidates for a product
 * - GET /pharmacy/inventory/batch-stats — batch counts
 *
 * @public
 */
@ApiTags('pharmacy-inventory-batches')
@Controller('pharmacy/inventory/batches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  /**
   * Receives a new stock batch with expiry tracking.
   * POST /pharmacy/inventory/batches
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'write')
  @ApiOperation({ summary: 'Receive a new stock batch' })
  async createBatch(@Request() req: ClinicAuthenticatedRequest, @Body() dto: CreateStockBatchDto) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.batchService.createBatch(dto, req.user?.id as string, clinicId);
  }

  /**
   * Lists batches with filtering by product and expiry window.
   * GET /pharmacy/inventory/batches?productId=&expiringWithinDays=&includeZeroStock=
   */
  @Get()
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.NURSE)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'List stock batches with filters' })
  async listBatches(@Request() req: ClinicAuthenticatedRequest, @Query() query: BatchFilterDto) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.batchService.listBatches(clinicId, query);
  }

  /**
   * Retrieves a single batch by ID within clinic scope.
   * GET /pharmacy/inventory/batches/:id
   */
  @Get(':id')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.NURSE)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @ApiOperation({ summary: 'Get batch details by ID' })
  async getBatchById(@Request() req: ClinicAuthenticatedRequest, @Param('id') id: string) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.batchService.getBatchById(id, clinicId);
  }

  /**
   * Gets FEFO-eligible batches for a product (earliest expiry first).
   * GET /pharmacy/inventory/fefo/:productId
   */
  @Get('fefo/:productId')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get FEFO candidates for a product' })
  async getFefoCandidates(
    @Request() req: ClinicAuthenticatedRequest,
    @Param('productId') productId: string,
    @Query('requiredQty') requiredQty?: string
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.batchService.getFefoCandidates(
      productId,
      clinicId,
      requiredQty ? Number(requiredQty) : undefined
    );
  }
}
