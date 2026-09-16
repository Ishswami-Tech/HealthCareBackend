/**
 * Diet Recommendation Engine — rule-based Ayurvedic diet advice
 * @module Diet/RecommendationEngine
 * @description Core rule engine for dosha-specific, seasonal, Agni-based, and Viruddhahara-aware recommendations
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import type {
  GenerateDietChartDto,
  GenerateDietChartResponseDto,
  CompatibilityViolationDto,
} from '@services/diet/dto';
import {
  DietaryGoal,
  DoshaType,
  AgniState,
  Season,
  MealSlot,
  CompatibilitySeverity,
} from '@services/diet/dto';
import {
  DOSHA_PREFERENCE,
  AGNI_PORTION_MULTIPLIER,
  SEASONAL_AGGR,
  SEASONAL_FOODS,
  ENGINE_CACHE_PREFIX,
  FALLBACK_VIRUDDHAHARA,
  buildFallbackKey,
  ruleKeySort,
  getSeasonLabel,
  detectCurrentSeason,
  buildPlanTitle,
  buildSummary,
  buildRulesFired,
} from '@services/diet/services/diet-engine-rules';
import { MealPlanGeneratorService } from '@services/diet/services/meal-plan-generator.service';
import { DietPlanService } from '@services/diet/services/diet-plan.service';

/**
 * Rule engine service for generating Ayurvedic diet recommendations.
 *
 * Incorporates:
 * 1. Dosha-based preferences (from latest PrakritiAnalysis)
 * 2. Seasonal adjustments (Ritucharya)
 * 3. Agni-state portion guidance
 * 4. Goal-based meal distribution
 * 5. Viruddhahara compatibility screening
 *
 * @public
 */
@Injectable()
export class DietRecommendationEngineService {
  /**
   * Creates an instance of DietRecommendationEngineService.
   * @param db - Database service for Prisma access
   * @param cache - Cache service for caching engine outputs
   * @param logger - Structured logging service
   * @param events - Event service for domain event emission
   * @param mealPlanGenerator - Meal slot allocation helper
   * @param dietPlanService - Diet plan CRUD helper
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly mealPlanGenerator: MealPlanGeneratorService,
    private readonly dietPlanService: DietPlanService
  ) {}

  /**
   * Generates a new Diet Plan for a patient using Ayurvedic rules.
   *
   * @param dto - Generation parameters
   * @param userId - User generating the plan
   * @param clinicId - Clinic context
   * @returns Generated plan with rule metadata
   */
  async generateDietChart(
    dto: GenerateDietChartDto,
    userId: string,
    clinicId: string
  ): Promise<GenerateDietChartResponseDto> {
    this.logger.info('Generating diet chart', {
      module: 'DietRecommendationEngine',
      patientId: dto.patientId,
      goal: dto.goal,
      clinicId,
    });

    // Step 1: Resolve patient context
    const patientCtx = await this.resolvePatientContext(
      dto.patientId,
      clinicId,
      dto.primaryDosha,
      dto.secondaryDosha,
      dto.agniState,
      dto.season
    );

    // Step 2: Query available foods
    const foods = await this.db.prisma.foodItem.findMany({
      where: { isActive: true },
    });

    if (foods.length === 0) {
      throw new HealthcareError(
        'Food catalog is empty. Please add food items before generating a diet chart.',
        ErrorCode.VALIDATION_ERROR,
        400,
        {},
        'DietRecommendationEngine.generateDietChart'
      );
    }

    // Step 3: Score foods
    const scoredFoods = this.scoreFoods(foods, patientCtx, dto.goal, dto.dietaryRestrictions);

    // Step 4: Allocate to meal slots
    const durationDays = dto.durationDays ?? 7;
    const mealPlan = this.mealPlanGenerator.allocateMeals(
      scoredFoods,
      patientCtx,
      dto.goal,
      durationDays
    );

    // Step 5: Screen for Viruddhahara violations
    const warnings = this.screenCompatibility(mealPlan);

    // Step 6: Persist
    const planResult = await this.dietPlanService.createDietPlan(
      {
        patientId: dto.patientId,
        title: buildPlanTitle(dto.goal),
        goal: dto.goal,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + durationDays * 86_400_000).toISOString(),
        summary: buildSummary(
          patientCtx.primaryDosha,
          patientCtx.secondaryDosha,
          patientCtx.agniState,
          patientCtx.season,
          dto.goal,
          mealPlan.length
        ),
        items: mealPlan,
      },
      userId,
      clinicId
    );

    // Step 7: Emit event
    await this.events.emit('diet.plan.generated', {
      dietPlanId: planResult.id,
      patientId: dto.patientId,
      clinicId,
      goal: dto.goal,
      durationDays,
      planTitle: buildPlanTitle(dto.goal),
      summary: buildSummary(
        patientCtx.primaryDosha,
        patientCtx.secondaryDosha,
        patientCtx.agniState,
        patientCtx.season,
        dto.goal,
        mealPlan.length
      ),
      createdByUserId: userId,
      rulesFired: buildRulesFired(
        patientCtx.primaryDosha,
        patientCtx.secondaryDosha,
        patientCtx.agniState,
        patientCtx.season,
        dto.goal
      ),
      warnings: warnings.length,
    });

    this.logger.info('Diet chart generated', {
      module: 'DietRecommendationEngine',
      dietPlanId: planResult.id,
      totalItems: mealPlan.length,
      warnings: warnings.length,
    });

    return {
      dietPlanId: planResult.id,
      totalItems: mealPlan.length,
      rulesFired: buildRulesFired(
        patientCtx.primaryDosha,
        patientCtx.secondaryDosha,
        patientCtx.agniState,
        patientCtx.season,
        dto.goal
      ),
      warnings,
      summary: buildSummary(
        patientCtx.primaryDosha,
        patientCtx.secondaryDosha,
        patientCtx.agniState,
        patientCtx.season,
        dto.goal,
        mealPlan.length
      ),
    };
  }

  /**
   * Resolves patient context needed for rule evaluation.
   */
  private async resolvePatientContext(
    patientId: string,
    _clinicId: string,
    explicitDosha?: DoshaType,
    explicitSecondaryDosha?: DoshaType,
    explicitAgni?: AgniState,
    explicitSeason?: Season
  ): Promise<{
    primaryDosha: DoshaType;
    secondaryDosha?: DoshaType;
    agniState: AgniState;
    season: Season;
    dietaryRestrictions: string[];
  }> {
    // Latest Prakriti analysis
    const latestPrakriti = await this.db.prisma.prakritiAnalysis.findFirst({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
      select: { primaryDosha: true, secondaryDosha: true },
    });

    const primaryDosha =
      explicitDosha ?? (latestPrakriti?.primaryDosha as DoshaType | undefined) ?? DoshaType.VATA;
    const secondaryDosha =
      explicitSecondaryDosha ?? (latestPrakriti?.secondaryDosha as DoshaType | undefined);

    const agniState = explicitAgni ?? AgniState.SAMA;
    const season = explicitSeason ?? detectCurrentSeason(new Date());

    const restrictionRows = await this.db.prisma.dietaryRestriction.findMany({
      where: { userId: patientId },
    });
    const dietaryRestrictions = restrictionRows.map((r: { restriction: string }) => r.restriction);

    const result: {
      primaryDosha: DoshaType;
      secondaryDosha?: DoshaType;
      agniState: AgniState;
      season: Season;
      dietaryRestrictions: string[];
    } = {
      primaryDosha,
      agniState,
      season,
      dietaryRestrictions,
    };

    if (secondaryDosha) {
      result.secondaryDosha = secondaryDosha;
    }

    return result;
  }

  /**
   * Scores each available food against patient context + goal.
   * Higher score = stronger recommendation.
   */
  private scoreFoods(
    foods: Array<{
      id: string;
      name: string;
      category: string;
      primaryRasa: string;
      secondaryRasas?: string[];
      virya: string;
      vipaka: string;
      pacifies?: string[];
      aggravates?: string[];
      defaultPortionGrams?: number;
      description?: string;
      tags?: string[];
    }>,
    ctx: {
      primaryDosha: DoshaType;
      secondaryDosha?: DoshaType;
      agniState: AgniState;
      season: Season;
      dietaryRestrictions: string[];
    },
    goal: DietaryGoal,
    explicitRestrictions?: string[]
  ): Array<{
    foodId: string;
    name: string;
    score: number;
    portionGrams: number;
    preferredMealSlots: import('@services/diet/dto').MealSlot[];
    tags: string[];
    reason: string;
  }> {
    const restrictionList = new Set([...ctx.dietaryRestrictions, ...(explicitRestrictions ?? [])]);

    const seasonalAggravated = SEASONAL_AGGR[ctx.season] ?? [];
    const seasonalFoodBonus = SEASONAL_FOODS[ctx.season] ?? {};

    return foods
      .map(food => {
        let score = 0;
        const reasons: string[] = [];

        // Dosha-based scoring
        const primaryPrefs = DOSHA_PREFERENCE[ctx.primaryDosha] ?? {};
        const primaryScore = primaryPrefs[food.name];
        if (primaryScore !== undefined) {
          score += primaryScore;
          if (primaryScore > 0) reasons.push(`pacifies ${ctx.primaryDosha}`);
        }

        if (ctx.secondaryDosha) {
          const secondaryPrefs = DOSHA_PREFERENCE[ctx.secondaryDosha] ?? {};
          const secondaryScore = secondaryPrefs[food.name];
          if (secondaryScore !== undefined) {
            score += Math.floor(secondaryScore * 0.5);
            if (secondaryScore > 0) reasons.push(`pacifies ${ctx.secondaryDosha}`);
          }
        }

        // Seasonal aggravation penalty
        for (const aggDosha of seasonalAggravated) {
          if ((food.aggravates ?? []).includes(aggDosha)) {
            score -= 2;
            reasons.push(`aggravates ${aggDosha} in ${getSeasonLabel(ctx.season)}`);
          }
        }

        // Seasonal food bonus
        for (const [keyword, bonus] of Object.entries(seasonalFoodBonus)) {
          if (food.name.toLowerCase().includes(keyword.toLowerCase())) {
            score += bonus;
            reasons.push(`seasonal recommendation for ${getSeasonLabel(ctx.season)}`);
          }
        }

        // Agni-based portion adjustment
        const agniMultiplier = AGNI_PORTION_MULTIPLIER[ctx.agniState] ?? 1.0;
        const portionGrams = Math.round((food.defaultPortionGrams ?? 150) * agniMultiplier);

        // Goal-based boost
        if (goal === DietaryGoal.WEIGHT_LOSS) {
          if (food.tags?.includes('light') || food.primaryRasa === 'KASHAYA') score += 1;
        } else if (goal === DietaryGoal.WEIGHT_GAIN) {
          if (food.tags?.includes('dense') || food.category === 'SUKHA_AHARA') score += 1;
        } else if (goal === DietaryGoal.DETOX) {
          if (['TIKTA', 'KASHAYA'].includes(food.primaryRasa)) score += 2;
        } else if (goal === DietaryGoal.REJUVENATION) {
          if (food.tags?.includes('rasayana') || food.category === 'SUKHA_AHARA') score += 2;
        }

        // Dietary restriction penalty
        for (const rest of restrictionList) {
          if (food.name.toLowerCase().includes(rest.toLowerCase())) {
            score -= 10;
            reasons.push(`excluded by dietary restriction: ${rest}`);
          }
        }

        // Preferred meal slot inference
        const preferredMealSlots = this.inferMealSlots(food);

        return {
          foodId: food.id,
          name: food.name,
          score,
          portionGrams: Math.max(portionGrams, 50),
          preferredMealSlots,
          tags: food.tags ?? [],
          reason: reasons.join('; ') || 'neutral',
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Infers which meal slots a food is suitable for.
   */
  private inferMealSlots(food: {
    name: string;
    tags?: string[];
    category: string;
  }): import('@services/diet/dto').MealSlot[] {
    const slots: import('@services/diet/dto').MealSlot[] = [];
    const name = food.name.toLowerCase();

    if (/rice|quinoa|barley|oats|porridge/.test(name)) {
      slots.push(MealSlot.BREAKFAST, MealSlot.LUNCH);
    }
    if (/soup|dal|daal|khichdi/.test(name) || food.category === 'SUKHA_AHARA') {
      slots.push(MealSlot.EVENING, MealSlot.DINNER);
    }
    if (/milk|ghee|buttermilk/.test(name)) {
      slots.push(MealSlot.BEDTIME, MealSlot.BREAKFAST);
    }
    if (/fruit/.test(name) || food.tags?.includes('fruit')) {
      slots.push(MealSlot.MID_MORNING);
    }
    if (/tea|herbal|decoction/.test(name)) {
      slots.push(MealSlot.EVENING);
    }
    if (slots.length === 0) slots.push(MealSlot.LUNCH);

    return [...new Set(slots)];
  }

  /**
   * Screens the generated meal plan for Viruddhahara violations.
   */
  private screenCompatibility(
    mealPlan: Array<{ foodItemId: string }>
  ): CompatibilityViolationDto[] {
    const warnings: CompatibilityViolationDto[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < mealPlan.length; i++) {
      for (let j = i + 1; j < mealPlan.length; j++) {
        const first = mealPlan[i]!;
        const second = mealPlan[j]!;
        const ids = [first.foodItemId, second.foodItemId].sort();
        const key = `${ids[0]}::${ids[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const fallbackKey = buildFallbackKey(first.foodItemId, second.foodItemId);
        const rule = FALLBACK_VIRUDDHAHARA[fallbackKey];
        if (
          rule &&
          (rule.severity === CompatibilitySeverity.HIGH ||
            rule.severity === CompatibilitySeverity.CONTRAINDICATED)
        ) {
          warnings.push({
            ruleId: `engine-scan:${fallbackKey}`,
            severity: rule.severity,
            description: `[Engine Warning] ${rule.description}`,
            ...(rule.classicalRef ? { classicalReference: rule.classicalRef } : {}),
          });
        }
      }
    }

    return warnings;
  }
}
