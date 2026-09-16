/**
 * Bed Management Service
 * @module Bed Management Service
 * @description Handles real-time bed board, status updates, and bed availability queries
 */

import { Injectable } from '@nestjs/common';
import type { BedBoardQueryDto, BedResponseDto, BedStatus, WardType } from '@services/ipd/dto';
import { BedStatus as BedStatusEnum } from '@services/ipd/dto';
import type { Bed, Ward } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';

/** Cache key prefix for bed board data */
const BED_BOARD_CACHE_PREFIX = 'ipd:bedboard';
/** Cache key prefix for ward data */
const WARD_CACHE_PREFIX = 'ipd:ward';
type BedBoardWhere = {
  clinicId: string;
  clinicLocationId: string;
  wardId?: string | { in: string[] };
  status?: string;
};

/**
 * Service for managing bed board and real-time bed status.
 *
 * Provides:
 * - Bed board view filtered by status and ward
 * - Bed status updates (available, occupied, cleaning, maintenance)
 * - Bed availability check for admissions
 * - Real-time bed statistics
 *
 * @public
 */
@Injectable()
export class BedManagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  /**
   * Retrieves the bed board with optional filtering.
   *
   * @param clinicId - Clinic context
   * @param query - Filter parameters (status, wardId, wardType, pagination)
   * @returns Paginated bed board results
   */
  async getBedBoard(
    clinicId: string,
    clinicLocationId: string,
    query: BedBoardQueryDto
  ): Promise<{
    data: BedResponseDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const cacheKey = `${BED_BOARD_CACHE_PREFIX}:${clinicId}:${clinicLocationId}:${query.status ?? 'all'}:${query.wardId ?? 'all'}:${query.wardType ?? 'all'}:${page}:${limit}`;

    const cached = await this.cache.get<{
      data: BedResponseDto[];
      total: number;
      page: number;
      limit: number;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const where: BedBoardWhere = { clinicId, clinicLocationId };

    if (query.wardId) {
      where.wardId = query.wardId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.wardType) {
      const wards = await this.db.prisma.ward.findMany({
        where: { clinicId, clinicLocationId, wardType: query.wardType },
        select: { id: true },
      });
      const wardIds = wards.map(w => w.id);
      where.wardId = { in: wardIds };
    }

    const [beds, total] = await Promise.all([
      this.db.prisma.bed.findMany({
        where: where as unknown as PrismaDelegateArgs,
        include: {
          ward: {
            select: {
              name: true,
              wardType: true,
              defaultDailyRate: true,
            },
          },
        },
        orderBy: [{ ward: { name: 'asc' } }, { bedNumber: 'asc' }],
        skip,
        take: limit,
      }),
      this.db.prisma.bed.count({ where: where as unknown as PrismaDelegateArgs }),
    ]);

    const data = beds.map(bed => this.mapBedToDto(bed));

    const result = { data, total, page, limit };
    await this.cache.set(cacheKey, result, 60);

    return result;
  }

  /**
   * Retrieves a specific bed by ID.
   *
   * @param id - Bed ID
   * @param clinicId - Clinic context
   * @returns Bed details
   * @throws {HealthcareError} If bed not found
   */
  async getBedById(
    id: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<BedResponseDto> {
    const cacheKey = `${BED_BOARD_CACHE_PREFIX}:bed:${clinicId}:${clinicLocationId}:${id}`;

    const cached = await this.cache.get<BedResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const bed = await this.db.prisma.bed.findFirst({
      where: { id, clinicId, clinicLocationId },
      include: {
        ward: {
          select: {
            name: true,
            wardType: true,
            defaultDailyRate: true,
          },
        },
      },
    });

    if (!bed) {
      throw new HealthcareError('Bed not found', ErrorCode.RESOURCE_NOT_FOUND, { bedId: id });
    }

    const result = this.mapBedToDto(bed);
    await this.cache.set(cacheKey, result, 120);

    return result;
  }

  /**
   * Updates the status of a bed (e.g., to cleaning after discharge).
   *
   * @param id - Bed ID
   * @param status - New bed status
   * @param clinicId - Clinic context
   * @returns Updated bed
   * @throws {HealthcareError} If bed not found
   * @throws {BadRequestException} If bed is occupied and trying to set to available
   */
  async updateBedStatus(
    id: string,
    status: BedStatus,
    clinicId: string,
    clinicLocationId: string
  ): Promise<BedResponseDto> {
    const existing = await this.db.prisma.bed.findFirst({
      where: { id, clinicId, clinicLocationId },
      include: { ward: true },
    });

    if (!existing) {
      throw new HealthcareError('Bed not found', ErrorCode.RESOURCE_NOT_FOUND, { bedId: id });
    }

    // Business rule: cannot mark occupied bed as available directly
    if (existing.status === BedStatusEnum.OCCUPIED && status === BedStatusEnum.AVAILABLE) {
      throw this.errorsService.ipdBedOccupiedTransferRequired(
        'AVAILABLE',
        'Discharge the patient',
        'BedManagementService.updateBedStatus'
      );
    }

    // Business rule: cannot mark occupied bed in maintenance
    if (existing.status === BedStatusEnum.OCCUPIED && status === BedStatusEnum.MAINTENANCE) {
      throw this.errorsService.ipdBedOccupiedTransferRequired(
        'MAINTENANCE',
        'Transfer the patient',
        'BedManagementService.updateBedStatus'
      );
    }

    const updated = await this.db.prisma.bed.update({
      where: { id },
      data: { status },
    });

    await this.invalidateBedBoardCache(clinicId, clinicLocationId);
    await this.events.emit('ipd.bed.statusChanged', {
      bedId: id,
      wardId: existing.wardId,
      clinicId,
      clinicLocationId,
      previousStatus: existing.status,
      newStatus: status,
    });

    this.logger.info('Bed status updated', {
      module: 'BedManagement',
      bedId: id,
      oldStatus: existing.status,
      newStatus: status,
    });

    return this.mapBedToDto(updated);
  }

  /**
   * Checks if a specific bed is available for admission.
   *
   * @param bedId - Bed ID
   * @param clinicId - Clinic context
   * @returns True if bed is available, false otherwise
   */
  async isBedAvailable(
    bedId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<boolean> {
    const bed = await this.db.prisma.bed.findFirst({
      where: { id: bedId, clinicId, clinicLocationId },
    });

    return bed?.status === BedStatusEnum.AVAILABLE;
  }

  /**
   * Gets all available beds in a ward.
   *
   * @param wardId - Ward ID
   * @param clinicId - Clinic context
   * @returns Array of available beds
   */
  async getAvailableBeds(
    wardId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<BedResponseDto[]> {
    const beds = await this.db.prisma.bed.findMany({
      where: { wardId, clinicId, clinicLocationId, status: BedStatusEnum.AVAILABLE },
      orderBy: { bedNumber: 'asc' },
    });

    return beds.map(bed => this.mapBedToDto(bed));
  }

  /**
   * Gets overall bed occupancy statistics for a clinic.
   *
   * @param clinicId - Clinic context
   * @returns Occupancy statistics
   */
  async getOccupancyStats(
    clinicId: string,
    clinicLocationId: string
  ): Promise<{
    totalBeds: number;
    occupiedBeds: number;
    availableBeds: number;
    cleaningBeds: number;
    maintenanceBeds: number;
    reservedBeds: number;
    occupancyRate: number;
    byWardType: Record<string, { total: number; occupied: number }>;
  }> {
    const [total, occupied, available, cleaning, maintenance, reserved, wards] = await Promise.all([
      this.db.prisma.bed.count({ where: { clinicId, clinicLocationId } }),
      this.db.prisma.bed.count({
        where: { clinicId, clinicLocationId, status: BedStatusEnum.OCCUPIED },
      }),
      this.db.prisma.bed.count({
        where: { clinicId, clinicLocationId, status: BedStatusEnum.AVAILABLE },
      }),
      this.db.prisma.bed.count({
        where: { clinicId, clinicLocationId, status: BedStatusEnum.CLEANING },
      }),
      this.db.prisma.bed.count({
        where: { clinicId, clinicLocationId, status: BedStatusEnum.MAINTENANCE },
      }),
      this.db.prisma.bed.count({
        where: { clinicId, clinicLocationId, status: BedStatusEnum.RESERVED },
      }),
      this.db.prisma.ward.findMany({
        where: { clinicId, clinicLocationId },
        select: {
          id: true,
          wardType: true,
          defaultDailyRate: true,
          _count: { select: { beds: true } },
        },
      }),
    ]);

    const byWardType: Record<string, { total: number; occupied: number }> = {};
    for (const ward of wards) {
      const [wardTotal, wardOccupied] = await Promise.all([
        this.db.prisma.bed.count({
          where: { wardId: ward.id, clinicId, clinicLocationId },
        }),
        this.db.prisma.bed.count({
          where: { wardId: ward.id, clinicId, clinicLocationId, status: BedStatusEnum.OCCUPIED },
        }),
      ]);
      byWardType[ward.wardType] = { total: wardTotal, occupied: wardOccupied };
    }

    return {
      totalBeds: total,
      occupiedBeds: occupied,
      availableBeds: available,
      cleaningBeds: cleaning,
      maintenanceBeds: maintenance,
      reservedBeds: reserved,
      occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : 0,
      byWardType,
    };
  }

  /**
   * Maps Prisma Bed model to response DTO.
   *
   * @param bed - Prisma Bed model with optional ward include
   * @returns Bed response DTO
   */
  private mapBedToDto(
    bed: Bed & { ward?: Pick<Ward, 'name' | 'wardType' | 'defaultDailyRate'> | null }
  ): BedResponseDto {
    return {
      id: bed.id,
      clinicId: bed.clinicId,
      clinicLocationId: bed.clinicLocationId,
      wardId: bed.wardId,
      wardName: bed.ward?.name,
      wardType: bed.ward?.wardType as WardType | undefined,
      bedNumber: bed.bedNumber,
      roomNumber: bed.roomNumber ?? undefined,
      bedType: bed.bedType ?? undefined,
      status: bed.status as BedStatus,
      dailyRate: bed.dailyRate ?? undefined,
      hasOxygen: bed.hasOxygen,
      hasVentilator: bed.hasVentilator,
      ...(bed.features != null ? { features: bed.features as Record<string, boolean> } : {}),
      notes: bed.notes ?? undefined,
      createdAt: bed.createdAt.toISOString(),
      updatedAt: bed.updatedAt.toISOString(),
    };
  }

  /**
   * Invalidates all bed board cache entries for a clinic.
   *
   * @param clinicId - Clinic ID
   */
  private async invalidateBedBoardCache(clinicId: string, clinicLocationId: string): Promise<void> {
    await Promise.all([
      this.cache.invalidatePattern(`${BED_BOARD_CACHE_PREFIX}:${clinicId}:${clinicLocationId}:*`),
      this.cache.invalidatePattern(`${WARD_CACHE_PREFIX}:*:${clinicId}:${clinicLocationId}:*`),
    ]);
  }
}
