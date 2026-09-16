/**
 * Pharmacy Inventory DTOs and Enums
 * @module Pharmacy Inventory
 * @description Data transfer objects for batch/lot tracking, FEFO dispense,
 *              expiry alerts, auto-reorder, and inter-clinic stock transfer
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsInt,
  IsDateString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  IsBoolean,
  ValidateNested,
  IsEnum,
  Min,
  Max,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MovementType } from '@core/types/enums.types';
import { TransferStatus } from '@core/types/enums.types';
import { ReorderStrategy } from '@core/types/enums.types';
import { AlertType } from '@core/types/enums.types';

// ============================================================================
// Enums (re-exported from central types)
// ============================================================================

export { MovementType, TransferStatus, ReorderStrategy, AlertType };

// ============================================================================
// CreateStockBatchDto
// ============================================================================

/**
 * Request DTO for receiving a new stock batch with expiry tracking
 */
export class CreateStockBatchDto {
  @ApiProperty({
    example: 'MED-2024-001',
    description: 'Product/medicine ID this batch belongs to',
  })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    example: 'BTL-PCM-2024-B003',
    description: 'Manufacturer batch/lot number',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lotNumber!: string;

  @ApiProperty({ example: '2024-06-15', description: 'Manufacture date (ISO)' })
  @IsDateString()
  manufactureDate!: string;

  @ApiProperty({
    example: '2026-06-15',
    description: 'Expiry date (ISO)',
  })
  @IsDateString()
  expiryDate!: string;

  @ApiProperty({
    example: 500,
    description: 'Quantity received into this batch',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    example: 25.5,
    description: 'Unit cost price (for cost-of-goods tracking)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional({
    example: 'PARACETAMOL',
    description: 'Medicine name at time of receipt',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  medicineName?: string;
}

// ============================================================================
// RecordStockMovementDto
// ============================================================================

/**
 * Request DTO for recording a stock movement
 */
export class RecordStockMovementDto {
  @ApiProperty({
    example: 'MED-2024-001',
    description: 'Product/medicine ID',
  })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    example: 'MED-2024-001-BTL-001',
    description: 'Batch ID the movement applies to',
  })
  @IsUUID()
  @IsNotEmpty()
  batchId!: string;

  @ApiProperty({
    enum: MovementType,
    description: 'Type of stock movement',
  })
  @IsEnum(MovementType)
  movementType!: MovementType;

  @ApiProperty({
    example: -5,
    description: 'Quantity change (negative for outbound, positive for inbound)',
  })
  @IsInt()
  quantity!: number;

  @ApiPropertyOptional({
    example: 'dispensed to patient',
    description: 'Reason for the movement',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    example: 'PRESC-001',
    description: 'Reference ID (prescription, transfer order, etc.)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceId?: string;

  @ApiPropertyOptional({
    example: 'DISPENSE',
    description: 'Reference type (DISPENSE, TRANSFER, ADJUSTMENT, etc.)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceType?: string;
}

// ============================================================================
// TransferStockDto
// ============================================================================

/**
 * Line item for a stock transfer
 */
export class TransferStockItemDto {
  @ApiProperty({ example: 'MED-2024-001' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 'BTL-PCM-2024-B003' })
  @IsUUID()
  @IsNotEmpty()
  batchId!: string;

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Request DTO for initiating an inter-clinic stock transfer
 */
export class TransferStockDto {
  @ApiProperty({
    example: 'CLINIC-002',
    description: 'Destination clinic ID',
  })
  @IsUUID()
  @IsNotEmpty()
  destinationClinicId!: string;

  @ApiPropertyOptional({
    example: 'Routine restock of analgesics',
    description: 'Transfer notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiProperty({
    type: [TransferStockItemDto],
    description: 'Stock items to transfer',
  })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => TransferStockItemDto)
  items!: TransferStockItemDto[];
}

// ============================================================================
// ReceiveTransferDto
// ============================================================================

/**
 * Request DTO for receiving a stock transfer at the destination clinic
 */
export class ReceiveTransferDto {
  @ApiPropertyOptional({
    example: 'All items received in good condition',
    description: 'Notes from the receiving clinic',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ============================================================================
// CreateReorderRuleDto
// ============================================================================

/**
 * Request DTO for creating/updating a reorder rule
 */
export class CreateReorderRuleDto {
  @ApiProperty({
    example: 'MED-2024-001',
    description: 'Product/medicine ID',
  })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiPropertyOptional({
    example: 'MED-2024-001',
    description: 'Optional category/supplier scope (future extension)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  scope?: string;

  @ApiProperty({
    enum: ReorderStrategy,
    description: 'Reorder strategy type',
  })
  @IsEnum(ReorderStrategy)
  strategy!: ReorderStrategy;

  @ApiProperty({
    example: 20,
    description: 'Reorder point: trigger reorder when on-hand falls to this level',
  })
  @IsInt()
  @Min(0)
  reorderPoint!: number;

  @ApiPropertyOptional({
    example: 100,
    description: 'Recommended order quantity (for FIXED_QTY strategy)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  orderQuantity?: number;

  @ApiPropertyOptional({
    example: 50,
    description: 'Minimum stock level (for MIN_MAX strategy)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minLevel?: number;

  @ApiPropertyOptional({
    example: 200,
    description: 'Maximum stock level (for MIN_MAX strategy)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxLevel?: number;

  @ApiPropertyOptional({
    example: 'Supplier ABC',
    description: 'Preferred supplier for this product',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  preferredSupplier?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================================================
// CreatePurchaseOrderDto
// ============================================================================

/**
 * Line item for a purchase order
 */
export class PurchaseOrderItemDto {
  @ApiProperty({ example: 'MED-2024-001' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 25.5, description: 'Unit price' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ example: 'Paracetamol 500mg', description: 'Item description' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

/**
 * Request DTO for creating a purchase order to a supplier
 */
export class CreatePurchaseOrderDto {
  @ApiProperty({
    example: 'SUP-001',
    description: 'Supplier ID',
  })
  @IsUUID()
  @IsNotEmpty()
  supplierId!: string;

  @ApiPropertyOptional({
    example: 'Urgent restock - analgesics and antibiotics',
    description: 'PO notes',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    example: '2026-09-10',
    description: 'Expected delivery date',
  })
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiProperty({
    type: [PurchaseOrderItemDto],
    description: 'PO line items',
  })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

// ============================================================================
// BatchFilterDto
// ============================================================================

/**
 * Query parameters for filtering batches
 */
export class BatchFilterDto {
  @ApiPropertyOptional({
    example: 'MED-2024-001',
    description: 'Filter by product ID',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    example: 90,
    description: 'Only return batches expiring within N days',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiringWithinDays?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  includeZeroStock?: boolean;
}

// ============================================================================
// DispenseFefoDto
// ============================================================================

/**
 * Item to dispense from specific batch (FEFO resolved)
 */
export class DispenseFefoItemDto {
  @ApiProperty({
    example: 'PRESC-ITEM-001',
    description: 'Prescription item ID',
  })
  @IsUUID()
  @IsNotEmpty()
  prescriptionItemId!: string;

  @ApiProperty({
    example: 'MED-2024-001',
    description: 'Medicine ID',
  })
  @IsUUID()
  @IsNotEmpty()
  medicineId!: string;

  @ApiProperty({
    example: 10,
    description: 'Quantity to dispense',
  })
  @IsInt()
  @Min(1)
  quantity!: number;
}

/**
 * Request DTO for FEFO-based prescription dispense
 */
export class DispenseFefoDto {
  @ApiProperty({
    type: [DispenseFefoItemDto],
    description: 'Prescription items to dispense (FEFO batch auto-selected)',
  })
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DispenseFefoItemDto)
  items!: DispenseFefoItemDto[];
}

// ============================================================================
// StockAdjustmentDto
// ============================================================================

/**
 * Request DTO for stock adjustments (waste, damage, correction)
 */
export class StockAdjustmentDto {
  @ApiProperty({ example: 'MED-2024-001' })
  @IsUUID()
  @IsNotEmpty()
  productId!: string;

  @ApiPropertyOptional({
    example: 'BTL-PCM-2024-B003',
    description: 'Batch ID (optional for product-level adjustments)',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({
    example: -3,
    description: 'Adjustment quantity (negative for write-off)',
  })
  @IsInt()
  quantity!: number;

  @ApiProperty({
    example: 'Damaged in storage',
    description: 'Reason for adjustment',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

// ============================================================================
// AlertQueryDto
// ============================================================================

/**
 * Query parameters for inventory alerts
 */
export class AlertQueryDto {
  @ApiPropertyOptional({
    enum: AlertType,
    description: 'Filter by alert type',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsEnum(AlertType, { each: true })
  alertTypes?: AlertType[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  criticalOnly?: boolean;
}
