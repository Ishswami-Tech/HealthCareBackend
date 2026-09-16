/**
 * Food Catalog Service — CRUD for FoodItem entries
 * @module Diet/FoodCatalog
 * @description Manages the Ayurvedic food catalog (FoodItem records)
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import type { CreateFoodItemDto, FoodItemResponseDto, FoodCategory } from '@services/diet/dto';

/**
 * Cache key prefix for the food catalog
 */
const FOOD_CATALOG_CACHE_PREFIX = 'diet:food:catalog';

/**
 * Service for managing the food catalog.
 *
 * @public
 */
@Injectable()
export class FoodCatalogService {
  /**
   * Creates an instance of FoodCatalogService.
   * @param db - Database service for Prisma access
   * @param cache - Cache service for catalog caching
   * @param logger - Structured logging service
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService
  ) {}

  /**
   * Creates a new food catalog entry.
   *
   * @param dto - Food item creation data
   * @returns Created food item
   */
  async createFoodItem(dto: CreateFoodItemDto): Promise<FoodItemResponseDto> {
    const foodItem = await this.db.prisma.foodItem.create({
      data: {
        name: dto.name,
        sanskritName: dto.sanskritName,
        category: dto.category,
        primaryRasa: dto.primaryRasa,
        secondaryRasas: dto.secondaryRasas ?? undefined,
        virya: dto.virya,
        vipaka: dto.vipaka,
        pacifies: dto.pacifies ?? undefined,
        aggravates: dto.aggravates ?? undefined,
        description: dto.description,
        defaultPortionGrams: dto.defaultPortionGrams ?? undefined,
        tags: dto.tags ?? undefined,
        isActive: true,
      },
    });

    await this.cache.del(FOOD_CATALOG_CACHE_PREFIX);

    this.logger.info('Food item created', {
      module: 'FoodCatalog',
      foodItemId: foodItem.id,
      name: foodItem.name,
    });

    return this.mapToResponseDto(foodItem);
  }

  /**
   * Searches the food catalog with optional filters.
   *
   * @param category - Optional food category filter
   * @param tag - Optional tag filter
   * @returns Array of matching food items
   */
  async listFoods(category?: FoodCategory, tag?: string): Promise<FoodItemResponseDto[]> {
    const cacheKey = `${FOOD_CATALOG_CACHE_PREFIX}:${category ?? 'all'}:${tag ?? 'all'}`;

    const cached = await this.cache.get<FoodItemResponseDto[]>(cacheKey);
    if (cached) return cached;

    const where: Record<string, unknown> = { isActive: true };
    if (category) where['category'] = category;
    if (tag) where['tags'] = { has: tag };

    const items = await this.db.prisma.foodItem.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    const result = items.map((item: (typeof items)[number]) => this.mapToResponseDto(item));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Maps a Prisma foodItem row to the response DTO.
   */
  private mapToResponseDto(row: {
    id: string;
    name: string;
    sanskritName?: string;
    category: string;
    primaryRasa: string;
    secondaryRasas?: string[];
    virya: string;
    vipaka: string;
    pacifies?: string[];
    aggravates?: string[];
    description?: string;
    defaultPortionGrams?: number;
    tags?: string[];
    createdAt: Date;
  }): FoodItemResponseDto {
    return {
      id: row.id,
      name: row.name,
      sanskritName: row.sanskritName ?? undefined,
      category: row.category as FoodCategory,
      primaryRasa: row.primaryRasa as FoodItemResponseDto['primaryRasa'],
      secondaryRasas: (row.secondaryRasas as FoodItemResponseDto['secondaryRasas']) ?? undefined,
      virya: row.virya as FoodItemResponseDto['virya'],
      vipaka: row.vipaka as FoodItemResponseDto['vipaka'],
      pacifies: (row.pacifies as FoodItemResponseDto['pacifies']) ?? undefined,
      aggravates: (row.aggravates as FoodItemResponseDto['aggravates']) ?? undefined,
      description: row.description ?? undefined,
      defaultPortionGrams: row.defaultPortionGrams ?? undefined,
      tags: (row.tags as string[] | undefined) ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
