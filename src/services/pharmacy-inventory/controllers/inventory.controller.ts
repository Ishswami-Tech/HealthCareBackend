/**
 * Inventory Controller
 * @module Pharmacy Inventory
 * @description Stock movement recording and dispense endpoints
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryService } from '../services/inventory.service';
import { AutoReorderService } from '../services/auto-reorder.service';
import { ExpiryAlertService } from '../services/expiry-alert.service';
import { PurchaseOrderService } from '../services/purchase-order.service';
import {
  RecordStockMovementDto,
  StockAdjustmentDto,
  DispenseFefoDto,
  AlertQueryDto,
  CreateReorderRuleDto,
  CreatePurchaseOrderDto,
} from '../dto/pharmacy-inventory.dto';
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
 * Controller for pharmacy inventory movement recording and dispensing.
 *
 * Endpoints:
 * - POST /pharmacy/inventory/movements — record stock movement
 * - PATCH /pharmacy/inventory/adjust — stock adjustment
 * - POST /pharmacy/dispense/:prescriptionId — FEFO-based dispense
 * - GET /pharmacy/inventory/alerts — active alerts
 * - POST /pharmacy/inventory/expired-writeoff — write off expired batches
 * - POST /pharmacy/inventory/reorder-rules — create reorder rule
 * - GET /pharmacy/inventory/reorder-evaluation — evaluate reorder rules
 *
 * @public
 */
@ApiTags('pharmacy-inventory')
@Controller('pharmacy/inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly autoReorderService: AutoReorderService,
    private readonly expiryAlertService: ExpiryAlertService,
    private readonly purchaseOrderService: PurchaseOrderService
  ) {}

  /**
   * Records a stock movement (in, out, adjust, transfer, expiry).
   * POST /pharmacy/inventory/movements
   */
  @Post('movements')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'write')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Record a stock movement' })
  async recordMovement(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: RecordStockMovementDto
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.inventoryService.recordMovement(dto, req.user?.id as string, clinicId);
  }

  /**
   * Records a stock adjustment (write-off, correction).
   * PATCH /pharmacy/inventory/adjust
   */
  @Patch('adjust')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'write')
  @ApiOperation({ summary: 'Adjust stock quantity' })
  async adjustStock(@Request() req: ClinicAuthenticatedRequest, @Body() dto: StockAdjustmentDto) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.inventoryService.adjustStock(dto, req.user?.id as string, clinicId);
  }

  /**
   * FEFO-based prescription dispense.
   * Replaces existing dispense logic with First-Expiry-First-Out batch consumption.
   * POST /pharmacy/dispense/:prescriptionId
   */
  @Post('dispense/:prescriptionId')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'write')
  @ApiOperation({ summary: 'FEFO-based prescription dispense' })
  async dispenseFefo(
    @Request() req: ClinicAuthenticatedRequest,
    @Param('prescriptionId') prescriptionId: string,
    @Body() dto: DispenseFefoDto
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.inventoryService.dispenseFefo(
      prescriptionId,
      dto,
      req.user?.id as string,
      clinicId
    );
  }

  /**
   * Retrieves active inventory alerts (expiry, low stock, out of stock).
   * GET /pharmacy/inventory/alerts
   */
  @Get('alerts')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.DOCTOR, Role.NURSE)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get active pharmacy inventory alerts' })
  async getAlerts(@Request() req: ClinicAuthenticatedRequest, @Query() query: AlertQueryDto) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.expiryAlertService.listAlerts(clinicId, {
      ...(query.alertTypes ? { alertTypes: query.alertTypes } : {}),
      ...(query.criticalOnly !== undefined ? { criticalOnly: query.criticalOnly } : {}),
    });
  }

  /**
   * Triggers write-off of already-expired batches.
   * POST /pharmacy/inventory/expired-writeoff
   */
  @Post('expired-writeoff')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'delete')
  @ApiOperation({ summary: 'Write off expired stock batches' })
  async writeOffExpired(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.expiryAlertService.writeOffExpired(clinicId, req.user?.id as string);
  }

  /**
   * Creates an auto-reorder rule for a product.
   * POST /pharmacy/inventory/reorder-rules
   */
  @Post('reorder-rules')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'write')
  @ApiOperation({ summary: 'Create auto-reorder rule' })
  async createReorderRule(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateReorderRuleDto
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.autoReorderService.createRule(dto, req.user?.id as string, clinicId);
  }

  /**
   * Evaluates all active reorder rules against current stock levels.
   * GET /pharmacy/inventory/reorder-evaluation
   */
  @Get('reorder-evaluation')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Evaluate reorder rules and get suggestions' })
  async evaluateReorderRules(@Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.autoReorderService.evaluateAll(clinicId);
  }

  /**
   * Retrieves movement history for the clinic.
   * GET /pharmacy/inventory/movements
   */
  @Get('movements')
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('pharmacy_inventory', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Get stock movement history' })
  async listMovements(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('productId') productId?: string,
    @Query('movementType') movementType?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0'
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.inventoryService.listMovements(clinicId, {
      ...(productId ? { productId } : {}),
      ...(movementType ? { movementType: movementType as any } : {}),
      limit: Number(limit),
      offset: Number(offset),
    });
  }

  /**
   * Creates a purchase order to a supplier.
   * POST /pharmacy/inventory/purchase-orders
   */
  @Post('purchase-orders')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.PHARMACIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('pharmacy_purchase_order', 'create')
  @ApiOperation({ summary: 'Create purchase order to supplier' })
  async createPurchaseOrder(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreatePurchaseOrderDto
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.purchaseOrderService.createPurchaseOrder(dto, req.user?.id as string, clinicId);
  }
}
