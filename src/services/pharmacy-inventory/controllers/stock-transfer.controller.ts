/**
 * Stock Transfer Controller
 * @module Pharmacy Inventory
 * @description Inter-clinic stock transfer endpoints with SUPER_ADMIN elevation
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StockTransferService } from '../services/stock-transfer.service';
import { TransferStockDto, ReceiveTransferDto } from '../dto/pharmacy-inventory.dto';
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
 * Controller for inter-clinic stock transfers.
 *
 * Endpoints:
 * - POST /pharmacy/inventory/transfers — initiate transfer (SUPER_ADMIN elevation)
 * - POST /pharmacy/inventory/transfers/:id/dispatch — dispatch (record OUT movements)
 * - POST /pharmacy/inventory/transfers/:id/receive — receive at destination
 * - PATCH /pharmacy/inventory/transfers/:id/cancel — cancel DRAFT transfer
 * - GET /pharmacy/inventory/transfers — list transfers (source/destination)
 *
 * RBAC:
 * - Initiating transfers requires SUPER_ADMIN (cross-clinic elevation)
 *   OR CLINIC_ADMIN with PHARMACY_TRANSFER_CREATE permission.
 * - Receiving transfers: PHARMACIST or CLINIC_ADMIN at destination.
 *
 * @public
 */
@ApiTags('pharmacy-inventory-transfers')
@Controller('pharmacy/inventory/transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class StockTransferController {
  constructor(private readonly stockTransferService: StockTransferService) {}

  /**
   * Checks if the requesting user has SUPER_ADMIN elevation for cross-clinic transfer.
   * Per the backend gap assessment, inter-clinic transfers require SUPER_ADMIN role.
   */
  private assertCrossClinicElevation(req: ClinicAuthenticatedRequest): void {
    const userRole = req.user?.role;
    if (userRole !== Role.SUPER_ADMIN && userRole !== Role.CLINIC_ADMIN) {
      throw new ForbiddenException(
        'Cross-clinic stock transfers require SUPER_ADMIN or CLINIC_ADMIN elevation'
      );
    }
  }

  /**
   * Initiates an inter-clinic stock transfer.
   * POST /pharmacy/inventory/transfers
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('pharmacy_transfer', 'create')
  @RateLimitAPI()
  @ApiOperation({ summary: 'Initiate inter-clinic stock transfer' })
  async createTransfer(@Request() req: ClinicAuthenticatedRequest, @Body() dto: TransferStockDto) {
    this.assertCrossClinicElevation(req);
    const sourceClinicId = req.clinicContext?.clinicId as string;
    return this.stockTransferService.createTransfer(dto, sourceClinicId, req.user?.id as string);
  }

  /**
   * Dispatches a DRAFT transfer to the destination (records OUT movements).
   * POST /pharmacy/inventory/transfers/:id/dispatch
   */
  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PHARMACIST)
  @RequireResourcePermission('pharmacy_transfer', 'create')
  @ApiOperation({ summary: 'Dispatch a DRAFT transfer (records OUT movements)' })
  async dispatchTransfer(@Request() req: ClinicAuthenticatedRequest, @Param('id') id: string) {
    const sourceClinicId = req.clinicContext?.clinicId as string;
    return this.stockTransferService.dispatchTransfer(id, sourceClinicId, req.user?.id as string);
  }

  /**
   * Receives a transfer at the destination (records IN movements + new batches).
   * POST /pharmacy/inventory/transfers/:id/receive
   */
  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PHARMACIST)
  @RequireResourcePermission('pharmacy_transfer', 'receive')
  @ApiOperation({ summary: 'Receive transfer at destination' })
  async receiveTransfer(
    @Request() req: ClinicAuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReceiveTransferDto
  ) {
    const destinationClinicId = req.clinicContext?.clinicId as string;
    return this.stockTransferService.receiveTransfer(
      id,
      destinationClinicId,
      req.user?.id as string
    );
  }

  /**
   * Cancels a DRAFT transfer.
   * PATCH /pharmacy/inventory/transfers/:id/cancel
   */
  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('pharmacy_transfer', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT transfer' })
  async cancelTransfer(@Request() req: ClinicAuthenticatedRequest, @Param('id') id: string) {
    const sourceClinicId = req.clinicContext?.clinicId as string;
    return this.stockTransferService.cancelTransfer(id, sourceClinicId);
  }

  /**
   * Lists transfers for the clinic.
   * GET /pharmacy/inventory/transfers?asSource=true|false
   */
  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PHARMACIST)
  @RequireResourcePermission('pharmacy_transfer', 'read')
  @RateLimitAPI()
  @ApiOperation({ summary: 'List stock transfers (source or destination)' })
  async listTransfers(
    @Request() req: ClinicAuthenticatedRequest,
    @Query('asSource') asSource = 'true'
  ) {
    const clinicId = req.clinicContext?.clinicId as string;
    return this.stockTransferService.listTransfers(clinicId, asSource === 'true');
  }
}
