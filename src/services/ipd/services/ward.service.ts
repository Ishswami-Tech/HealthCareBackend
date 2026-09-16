/**
 * Ward Service
 * @module Ward Service
 * @description Handles ward configuration and CRUD operations
 */

import { Injectable } from '@nestjs/common';
import type {
  CreateWardDto,
  UpdateWardDto,
  WardResponseDto,
  CreateBedDto,
  UpdateBedDto,
  BedResponseDto,
  WardType,
  BedStatus,
} from '@services/ipd/dto';
import { BedStatus as BedStatusEnum } from '@services/ipd/dto';
import type { Bed, Ward } from '@core/types/database.types';
import type { PrismaDelegateArgs } from '@core/types/prisma.types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';

type WardRecord = Ward;
type BedRecord = Bed & {
  ward?: Pick<Ward, 'name' | 'wardType' | 'defaultDailyRate'> | null;
};
type WardCreateData = {
  name: string;
  wardType: string;
  clinicId: string;
  clinicLocationId: string;
  location: string | undefined;
  totalBeds: number;
  isActive: boolean;
  notes: string | undefined;
  createdBy: string;
};
type WardUpdateData = {
  name?: string;
  wardType?: string;
  location?: string;
  totalBeds?: number;
  isActive?: boolean;
  notes?: string;
};
type BedCreateData = {
  wardId: string;
  clinicId: string;
  clinicLocationId: string;
  bedNumber: string;
  roomNumber: string | undefined;
  bedType: string | undefined;
  dailyRate: number | undefined;
  hasOxygen: boolean;
  hasVentilator: boolean;
  features: Record<string, boolean> | undefined;
  status: string;
  notes: string | undefined;
  createdBy: string;
};
type BedUpdateData = {
  bedNumber?: string;
  roomNumber?: string;
  bedType?: string;
  dailyRate?: number;
  hasOxygen?: boolean;
  hasVentilator?: boolean;
  status?: string;
  features?: Record<string, boolean>;
  notes?: string;
};

/** Cache key prefix for ward data */
const WARD_CACHE_PREFIX = 'ipd:ward';

/**
 * Service for managing hospital wards and beds.
 *
 * Provides CRUD operations for:
 * - Ward creation, updates, and retrieval
 * - Bed configuration within wards
 * - Bed count statistics per ward
 *
 * @public
 */
@Injectable()
export class WardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  // ============ Ward CRUD ============

  /**
   * Creates a new ward.
   *
   * @param dto - Ward creation data
   * @param userId - ID of the creating user
   * @returns Created ward with populated counts
   * @throws {BadRequestException} If ward of same name already exists in clinic
   */
  async createWard(
    dto: CreateWardDto,
    userId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<WardResponseDto> {
    this.logger.info('Creating ward', {
      module: 'WardService',
      wardName: dto.name,
      clinicId,
      clinicLocationId,
    });

    const existing = await this.db.prisma.ward.findFirst({
      where: { name: dto.name, clinicId, clinicLocationId },
    });

    if (existing) {
      throw this.errorsService.ipdWardAlreadyExists(dto.name, 'WardService.createWard');
    }

    const wardCreateData: WardCreateData = {
      name: dto.name,
      wardType: dto.wardType,
      clinicId,
      clinicLocationId,
      location: dto.location,
      totalBeds: dto.totalBeds ?? 0,
      isActive: dto.isActive ?? true,
      notes: dto.notes,
      createdBy: userId,
    };

    const ward = await this.db.prisma.ward.create({
      data: wardCreateData as unknown as PrismaDelegateArgs,
    });

    await this.invalidateWardCaches(clinicId, clinicLocationId);
    await this.invalidateBedBoardCaches(clinicId, clinicLocationId);
    await this.events.emit('ipd.ward.created', { wardId: ward.id, clinicId, clinicLocationId });

    this.logger.info('Ward created', { module: 'WardService', wardId: ward.id });

    return this.mapWardToDto(ward);
  }

  /**
   * Retrieves all wards for a clinic.
   *
   * @param clinicId - Clinic context
   * @returns Array of wards with bed statistics
   */
  async getAllWards(clinicId: string, clinicLocationId: string): Promise<WardResponseDto[]> {
    const cacheKey = `${WARD_CACHE_PREFIX}:all:${clinicId}:${clinicLocationId}`;

    const cached = await this.cache.get<WardResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const wards = await this.db.prisma.ward.findMany({
      where: { clinicId, clinicLocationId },
      orderBy: { name: 'asc' },
    });

    const result = await Promise.all(wards.map(w => this.enrichWardWithCounts(w)));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Retrieves a specific ward by ID.
   *
   * @param id - Ward ID
   * @param clinicId - Clinic context
   * @returns Ward details with bed statistics
   * @throws {HealthcareError} If ward not found
   */
  async getWardById(
    id: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<WardResponseDto> {
    const cacheKey = `${WARD_CACHE_PREFIX}:${clinicId}:${clinicLocationId}:${id}`;

    const cached = await this.cache.get<WardResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const ward = await this.db.prisma.ward.findFirst({ where: { id, clinicId, clinicLocationId } });

    if (!ward) {
      throw new HealthcareError('Ward not found', ErrorCode.RESOURCE_NOT_FOUND, { wardId: id });
    }

    const result = await this.enrichWardWithCounts(ward);
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Updates a ward's details.
   *
   * @param id - Ward ID
   * @param dto - Update data
   * @param clinicId - Clinic context
   * @returns Updated ward
   * @throws {HealthcareError} If ward not found
   * @throws {BadRequestException} If new name conflicts with existing ward
   */
  async updateWard(
    id: string,
    dto: UpdateWardDto,
    clinicId: string,
    clinicLocationId: string
  ): Promise<WardResponseDto> {
    const existing = await this.db.prisma.ward.findFirst({
      where: { id, clinicId, clinicLocationId },
    });

    if (!existing) {
      throw new HealthcareError('Ward not found', ErrorCode.RESOURCE_NOT_FOUND, { wardId: id });
    }

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db.prisma.ward.findFirst({
        where: { name: dto.name, clinicId, clinicLocationId, id: { not: id } },
      });
      if (nameConflict) {
        throw this.errorsService.ipdWardAlreadyExists(dto.name, 'WardService.updateWard');
      }
    }

    const updateData: WardUpdateData = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.wardType !== undefined) updateData.wardType = dto.wardType;
    if (dto.location !== undefined) updateData.location = dto.location;
    if (dto.totalBeds !== undefined) updateData.totalBeds = dto.totalBeds;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const updated = await this.db.prisma.ward.update({
      where: { id },
      data: updateData as unknown as PrismaDelegateArgs,
    });

    await this.invalidateWardCaches(clinicId, clinicLocationId);
    await this.invalidateBedBoardCaches(clinicId, clinicLocationId);
    await this.events.emit('ipd.ward.updated', { wardId: id, clinicId, clinicLocationId });

    this.logger.info('Ward updated', { module: 'WardService', wardId: id });

    return this.mapWardToDto(updated);
  }

  // ============ Bed CRUD ============

  /**
   * Creates a new bed in a ward.
   *
   * @param dto - Bed creation data
   * @param userId - ID of the creating user
   * @returns Created bed
   * @throws {BadRequestException} If ward not found or bed number already exists
   */
  async createBed(
    dto: CreateBedDto,
    userId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<BedResponseDto> {
    this.logger.info('Creating bed', {
      module: 'WardService',
      wardId: dto.wardId,
      bedNumber: dto.bedNumber,
      clinicId,
      clinicLocationId,
    });

    const ward = await this.db.prisma.ward.findFirst({
      where: { id: dto.wardId, clinicId, clinicLocationId },
    });
    if (!ward) {
      throw this.errorsService.ipdWardNotFound(dto.wardId, 'WardService.createBed');
    }

    const existing = await this.db.prisma.bed.findFirst({
      where: { wardId: dto.wardId, clinicId, clinicLocationId, bedNumber: dto.bedNumber },
    });

    if (existing) {
      throw this.errorsService.ipdBedAlreadyExists(dto.bedNumber, 'WardService.createBed');
    }

    const bedCreateData: BedCreateData = {
      wardId: dto.wardId,
      clinicId,
      clinicLocationId,
      bedNumber: dto.bedNumber,
      roomNumber: dto.roomNumber,
      bedType: dto.bedType,
      dailyRate: dto.dailyRate,
      hasOxygen: dto.hasOxygen ?? false,
      hasVentilator: dto.hasVentilator ?? false,
      features: dto.features ?? {},
      status: dto.status ?? BedStatusEnum.AVAILABLE,
      notes: dto.notes,
      createdBy: userId,
    };

    const bed = await this.db.prisma.bed.create({
      data: bedCreateData as unknown as PrismaDelegateArgs,
    });

    await this.invalidateWardCaches(clinicId, clinicLocationId);
    await this.invalidateBedCaches(clinicId, clinicLocationId);
    await this.invalidateBedBoardCaches(clinicId, clinicLocationId);
    await this.events.emit('ipd.bed.created', {
      bedId: bed.id,
      wardId: dto.wardId,
      clinicId,
      clinicLocationId,
    });

    this.logger.info('Bed created', { module: 'WardService', bedId: bed.id });

    return this.mapBedToDto({ ...bed, ward });
  }

  /**
   * Updates bed details.
   *
   * @param id - Bed ID
   * @param dto - Update data
   * @param clinicId - Clinic context
   * @returns Updated bed
   * @throws {HealthcareError} If bed not found
   */
  async updateBed(
    id: string,
    dto: UpdateBedDto,
    clinicId: string,
    clinicLocationId: string
  ): Promise<BedResponseDto> {
    const existing = await this.db.prisma.bed.findFirst({
      where: { id, clinicId, clinicLocationId },
    });

    if (!existing) {
      throw new HealthcareError('Bed not found', ErrorCode.RESOURCE_NOT_FOUND, { bedId: id });
    }

    const updateData: BedUpdateData = {};
    if (dto.bedNumber !== undefined) updateData.bedNumber = dto.bedNumber;
    if (dto.roomNumber !== undefined) updateData.roomNumber = dto.roomNumber;
    if (dto.bedType !== undefined) updateData.bedType = dto.bedType;
    if (dto.dailyRate !== undefined) updateData.dailyRate = dto.dailyRate;
    if (dto.hasOxygen !== undefined) updateData.hasOxygen = dto.hasOxygen;
    if (dto.hasVentilator !== undefined) updateData.hasVentilator = dto.hasVentilator;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.features !== undefined) updateData.features = dto.features;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const updated = await this.db.prisma.bed.update({
      where: { id },
      data: updateData as unknown as PrismaDelegateArgs,
    });

    await this.invalidateWardCaches(clinicId, clinicLocationId);
    await this.invalidateBedCaches(clinicId, clinicLocationId);
    await this.invalidateBedBoardCaches(clinicId, clinicLocationId);
    await this.events.emit('ipd.bed.updated', {
      bedId: id,
      wardId: existing.wardId,
      clinicId,
      clinicLocationId,
    });

    this.logger.info('Bed updated', { module: 'WardService', bedId: id });

    return this.mapBedToDto(updated);
  }

  /**
   * Retrieves all wards with available bed counts.
   *
   * @param clinicId - Clinic context
   * @returns Array of wards with bed statistics
   */
  async getWardStatistics(clinicId: string, clinicLocationId: string): Promise<WardResponseDto[]> {
    return this.getAllWards(clinicId, clinicLocationId);
  }

  // ============ Private Helpers ============

  /**
   * Enriches ward data with bed count statistics.
   *
   * @param ward - Prisma Ward model
   * @returns Ward DTO with computed bed counts
   */
  private async enrichWardWithCounts(ward: WardRecord): Promise<WardResponseDto> {
    const [occupiedCount, availableCount] = await Promise.all([
      this.db.prisma.bed.count({
        where: {
          wardId: ward.id,
          clinicId: ward.clinicId,
          clinicLocationId: ward.clinicLocationId,
          status: BedStatusEnum.OCCUPIED,
        },
      }),
      this.db.prisma.bed.count({
        where: {
          wardId: ward.id,
          clinicId: ward.clinicId,
          clinicLocationId: ward.clinicLocationId,
          status: BedStatusEnum.AVAILABLE,
        },
      }),
    ]);

    return {
      ...this.mapWardToDto(ward),
      occupiedBeds: occupiedCount,
      availableBeds: availableCount,
      totalBedCount: ward.totalBeds,
      defaultDailyRate: ward.defaultDailyRate ?? undefined,
    };
  }

  /**
   * Maps Prisma Ward model to response DTO.
   *
   * @param ward - Prisma Ward model
   * @returns Ward response DTO
   */
  private mapWardToDto(ward: WardRecord): WardResponseDto {
    return {
      id: ward.id,
      clinicId: ward.clinicId,
      clinicLocationId: ward.clinicLocationId,
      name: ward.name,
      wardType: ward.wardType as WardType,
      ...(ward.location != null ? { location: ward.location } : {}),
      ...(ward.totalBeds !== undefined ? { totalBeds: ward.totalBeds } : {}),
      isActive: ward.isActive,
      ...(ward.notes != null ? { notes: ward.notes } : {}),
      ...(ward.defaultDailyRate != null ? { defaultDailyRate: ward.defaultDailyRate } : {}),
      createdAt: ward.createdAt.toISOString(),
      updatedAt: ward.updatedAt.toISOString(),
    };
  }

  /**
   * Maps Prisma Bed model to response DTO.
   *
   * @param bed - Prisma Bed model
   * @returns Bed response DTO
   */
  private mapBedToDto(bed: BedRecord): BedResponseDto {
    return {
      id: bed.id,
      clinicId: bed.clinicId,
      clinicLocationId: bed.clinicLocationId,
      wardId: bed.wardId,
      bedNumber: bed.bedNumber,
      wardName: bed.ward?.name,
      wardType: bed.ward?.wardType as WardType | undefined,
      ...(bed.roomNumber != null ? { roomNumber: bed.roomNumber } : {}),
      ...(bed.bedType != null ? { bedType: bed.bedType } : {}),
      status: bed.status as BedStatus,
      ...(bed.dailyRate != null ? { dailyRate: bed.dailyRate } : {}),
      hasOxygen: bed.hasOxygen,
      hasVentilator: bed.hasVentilator,
      ...(bed.features != null ? { features: bed.features as Record<string, boolean> } : {}),
      ...(bed.notes != null ? { notes: bed.notes } : {}),
      createdAt: bed.createdAt.toISOString(),
      updatedAt: bed.updatedAt.toISOString(),
    };
  }

  /**
   * Invalidates all cache entries related to a ward.
   *
   * @param wardId - Ward ID
   * @param clinicId - Clinic ID
   */
  private async invalidateWardCaches(clinicId: string, clinicLocationId: string): Promise<void> {
    const pattern = `${WARD_CACHE_PREFIX}:*:${clinicId}:${clinicLocationId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Invalidates all cache entries related to a bed.
   *
   * @param bedId - Bed ID
   * @param wardId - Ward ID
   * @param clinicId - Clinic ID
   */
  private async invalidateBedCaches(clinicId: string, clinicLocationId: string): Promise<void> {
    const pattern = `ipd:bedboard:bed:${clinicId}:${clinicLocationId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Invalidates all bed-board cache entries related to a clinic location.
   *
   * @param clinicId - Clinic ID
   * @param clinicLocationId - Clinic location ID
   */
  private async invalidateBedBoardCaches(
    clinicId: string,
    clinicLocationId: string
  ): Promise<void> {
    await this.cache.invalidatePattern(`ipd:bedboard:${clinicId}:${clinicLocationId}:*`);
  }
}
