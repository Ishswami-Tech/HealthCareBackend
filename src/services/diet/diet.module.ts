/**
 * Diet Module
 * @module Diet
 * @description NestJS module wiring the Ayurvedic Diet Chart Generator
 *
 * Provides:
 * - Ayurvedic diet recommendation engine (dosha, seasonal, Agni-based, Viruddhahara)
 * - Diet Plan CRUD (header + meal items)
 * - Meal plan generation (slot allocation across days)
 * - Food catalog (create + search)
 * - Viruddhahara compatibility checks
 *
 * Required permissions:
 * - DIET_PLAN_MANAGE: Create/update diet plans and food items
 * - DIET_PLAN_VIEW:   Read diet plans and search food catalog
 *
 * @public
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { EventsModule } from '@infrastructure/events';
import { RbacModule } from '@core/rbac/rbac.module';

import { DietController } from '@services/diet/diet.controller';
import { DietRecommendationEngineService } from '@services/diet/services/diet-recommendation-engine.service';
import { DietPlanService } from '@services/diet/services/diet-plan.service';
import { MealPlanGeneratorService } from '@services/diet/services/meal-plan-generator.service';
import { FoodCompatibilityService } from '@services/diet/services/food-compatibility.service';
import { FoodCatalogService } from '@services/diet/services/food-catalog.service';

/**
 * NestJS module for Ayurvedic Diet Chart Generator APIs.
 *
 * @public
 */
@Module({
  imports: [DatabaseModule, CacheModule, LoggingModule, ErrorsModule, EventsModule, RbacModule],
  controllers: [DietController],
  providers: [
    DietRecommendationEngineService,
    DietPlanService,
    MealPlanGeneratorService,
    FoodCompatibilityService,
    FoodCatalogService,
  ],
  exports: [
    DietRecommendationEngineService,
    DietPlanService,
    MealPlanGeneratorService,
    FoodCompatibilityService,
    FoodCatalogService,
  ],
})
export class DietModule {}
