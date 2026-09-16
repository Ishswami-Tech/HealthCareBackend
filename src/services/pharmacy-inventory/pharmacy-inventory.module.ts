/**
 * Pharmacy Inventory Module
 * @module Pharmacy Inventory
 * @description NestJS module wiring all pharmacy inventory management services
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';

import { InventoryController } from './controllers/inventory.controller';
import { BatchController } from './controllers/batch.controller';
import { StockTransferController } from './controllers/stock-transfer.controller';
import { InventoryService } from './services/inventory.service';
import { BatchService } from './services/batch.service';
import { ExpiryAlertService } from './services/expiry-alert.service';
import { AutoReorderService } from './services/auto-reorder.service';
import { StockTransferService } from './services/stock-transfer.service';
import { PurchaseOrderService } from './services/purchase-order.service';

/**
 * NestJS module for pharmacy inventory management.
 *
 * Provides:
 * - Stock batch/lot tracking with FEFO dispense
 * - Stock movement recording (in/out/adjust/transfer/expiry)
 * - Expiry alert scanning (30/60/90 day windows)
 * - Auto-reorder rule management and evaluation
 * - Inter-clinic stock transfer (SUPER_ADMIN elevation)
 * - Purchase order creation and tracking
 *
 * Required permissions:
 * - PHARMACY_INVENTORY_READ: View inventory data
 * - PHARMACY_INVENTORY_WRITE: Create/update batches, record movements
 * - PHARMACY_INVENTORY_DELETE: Adjust/write-off stock
 * - PHARMACY_TRANSFER_CREATE: Initiate inter-clinic transfers
 * - PHARMACY_TRANSFER_RECEIVE: Receive transfers at destination
 * - PHARMACY_PURCHASE_ORDER_MANAGE: Create/send purchase orders
 *
 * Guards: JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard
 *
 * @public
 */
@Module({
  imports: [DatabaseModule, CacheModule, LoggingModule, ErrorsModule, EventsModule, RbacModule],
  controllers: [InventoryController, BatchController, StockTransferController],
  providers: [
    InventoryService,
    BatchService,
    ExpiryAlertService,
    AutoReorderService,
    StockTransferService,
    PurchaseOrderService,
  ],
  exports: [InventoryService, BatchService, StockTransferService],
})
export class PharmacyInventoryModule {}
