/**
 * Diet Controller
 * @module Diet
 * @description REST controller for Ayurvedic Diet Chart Generator APIs
 *
 * Endpoints:
 * - POST   /diet/plans/generate      — Generate a diet chart via rule engine
 * - GET    /diet/plans?patientId=    — List plans for a patient
 * - GET    /diet/plans/:id           — Retrieve a specific plan
 * - PATCH  /diet/plans/:id           — Update a plan (header + optional items)
 * - POST   /diet/foods               — Create a food catalog entry
 * - GET    /diet/foods?category=&tag=— Search food catalog
 * - POST   /diet/compatibility/check — Viruddhahara compatibility lookup
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import {
  DietRecommendationEngineService,
  DietPlanService,
  FoodCompatibilityService,
  FoodCatalogService,
} from '@services/diet/services';
import type {
  GenerateDietChartDto,
  UpdateDietPlanDto,
  CreateFoodItemDto,
  CheckCompatibilityDto,
  GenerateDietChartResponseDto,
  DietPlanResponseDto,
  FoodItemResponseDto,
  CompatibilityCheckResponseDto,
} from '@services/diet/dto';
import { DietaryGoal, FoodCategory } from '@services/diet/dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

// ============ Query DTOs ============

/**
 * Query parameters for listing diet plans
 */
class ListDietPlansQueryDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;
}

/**
 * Query parameters for food catalog search
 */
class ListFoodsQueryDto {
  @IsOptional()
  @IsEnum(Object.values(FoodCategory))
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tag?: string;
}

// ============ Controller ============

/**
 * Controller for Ayurvedic Diet Chart Generator APIs.
 *
 * All endpoints require authentication + RBAC + clinic context.
 *
 * @public
 */
@Controller('diet')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class DietController {
  /**
   * Creates an instance of DietController.
   * @param engine - Recommendation rule engine
   * @param dietPlanService - Plan CRUD operations
   * @param foodCompatibilityService - Viruddhahara screening
   * @param foodCatalogService - Food catalog operations
   */
  constructor(
    private readonly engine: DietRecommendationEngineService,
    private readonly dietPlanService: DietPlanService,
    private readonly foodCompatibilityService: FoodCompatibilityService,
    private readonly foodCatalogService: FoodCatalogService
  ) {}

  // ============ Plan Generation ============

  /**
   * Generates a new diet chart for a patient using the Ayurvedic rule engine.
   *
   * POST /diet/plans/generate
   *
   * Rule layers applied:
   * 1. Dosha-based food preferences (from latest PrakritiAnalysis)
   * 2. Seasonal adjustments (Ritucharya)
   * 3. Agni-state portion guidance
   * 4. Dietary goal distribution (weight loss/gain/detox/balance/rejuvenation)
   * 5. Viruddhahara compatibility screening
   *
   * @param dto - Generation parameters
   * @returns Generated plan with rule metadata
   */
  @Post('plans/generate')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NUTRITIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('diet_plan', 'manage')
  async generateDietChart(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: GenerateDietChartDto
  ): Promise<GenerateDietChartResponseDto> {
    return this.engine.generateDietChart(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  // ============ Plan CRUD ============

  /**
   * Lists diet plans for a patient.
   *
   * GET /diet/plans?patientId=
   *
   * @param query - Query parameters
   * @returns Array of diet plans (header + items)
   */
  @Get('plans')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NUTRITIONIST,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('diet_plan', 'view', { requireOwnership: true })
  async getDietPlans(
    @Query() query: ListDietPlansQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DietPlanResponseDto[]> {
    return this.dietPlanService.getPlansForPatient(
      query.patientId,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Retrieves a single diet plan by ID.
   *
   * GET /diet/plans/:id
   *
   * @param id - Plan ID
   * @returns Diet plan with all items
   */
  @Get('plans/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NUTRITIONIST,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('diet_plan', 'view')
  async getDietPlan(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DietPlanResponseDto> {
    return this.dietPlanService.getPlanById(id, req.clinicContext?.clinicId as string);
  }

  /**
   * Updates a diet plan (header fields and/or item replacement).
   *
   * PATCH /diet/plans/:id
   *
   * If `items` are provided, they fully replace existing items.
   *
   * @param id - Plan ID
   * @param dto - Update data
   * @returns Updated plan
   */
  @Patch('plans/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NUTRITIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('diet_plan', 'manage')
  async updateDietPlan(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: UpdateDietPlanDto
  ): Promise<DietPlanResponseDto> {
    return this.dietPlanService.updatePlan(id, dto, req.clinicContext?.clinicId as string);
  }

  // ============ Food Catalog CRUD ============

  /**
   * Creates a new food catalog entry.
   *
   * POST /diet/foods
   *
   * @param dto - Food item creation data
   * @returns Created food item
   */
  @Post('foods')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NUTRITIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('diet_plan', 'manage')
  async createFoodItem(
    @Request() _req: ClinicAuthenticatedRequest,
    @Body() dto: CreateFoodItemDto
  ): Promise<FoodItemResponseDto> {
    return this.foodCatalogService.createFoodItem(dto);
  }

  /**
   * Searches the food catalog with optional filters.
   *
   * GET /diet/foods?category=&tag=
   *
   * @param query - Filter parameters
   * @returns Array of matching food items
   */
  @Get('foods')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NUTRITIONIST,
    Role.NURSE,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('diet_plan', 'view')
  async listFoods(
    @Query() query: ListFoodsQueryDto,
    @Request() _req: ClinicAuthenticatedRequest
  ): Promise<FoodItemResponseDto[]> {
    const categoryEnum = query.category ? (query.category as FoodCategory) : undefined;
    return this.foodCatalogService.listFoods(categoryEnum, query.tag);
  }

  // ============ Viruddhahara Compatibility ============

  /**
   * Checks Ayurvedic food compatibility (Viruddhahara) between two food items.
   *
   * POST /diet/compatibility/check
   *
   * Evaluates classical rules, DB-stored rules, and patient-specific dosha warnings.
   *
   * @param dto - Compatibility check parameters
   * @returns Detailed compatibility verdict
   */
  @Post('compatibility/check')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NUTRITIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('diet_plan', 'view')
  async checkCompatibility(
    @Request() _req: ClinicAuthenticatedRequest,
    @Body() dto: CheckCompatibilityDto
  ): Promise<CompatibilityCheckResponseDto> {
    return this.foodCompatibilityService.checkCompatibility(dto);
  }
}
