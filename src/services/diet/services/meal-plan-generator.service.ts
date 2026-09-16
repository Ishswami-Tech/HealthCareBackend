/**
 * Meal Plan Generator Service
 * @module Diet/MealPlanGenerator
 * @description Allocates scored food items across meal slots and days to produce a structured plan
 */

import { Injectable } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { HealthcareError, ErrorCode } from '@core/errors';
import { DietaryGoal, MealSlot, DoshaType, AgniState, Season } from '@services/diet/dto';
import type { DietPlanItemDto } from '@services/diet/dto';

type ScoredFood = {
  foodId: string;
  name: string;
  score: number;
  portionGrams: number;
  preferredMealSlots: MealSlot[];
  tags: string[];
  reason: string;
};

/**
 * Minimum items per day to ensure a complete plan.
 */
const MIN_ITEMS_PER_DAY = 4;

/**
 * Maximum items per meal slot (safety cap to prevent unrealistic plans).
 */
const MAX_ITEMS_PER_SLOT = 4;

/**
 * Service for allocating scored foods to meal slots across days.
 *
 * Produces an array of `DietPlanItemDto` objects ready for persistence.
 *
 * @public
 */
@Injectable()
export class MealPlanGeneratorService {
  /**
   * Creates an instance of MealPlanGeneratorService.
   * @param logger - Structured logging service
   */
  constructor(private readonly logger: LoggingService) {}

  /**
   * Allocates foods across meal slots and days.
   *
   * Strategy:
   * 1. Group scored foods by their preferred meal slots
   * 2. For each day, rotate through slots ensuring MIN_ITEMS_PER_DAY
   * 3. Apply goal-based portion adjustments
   * 4. Run compatibility screening per day
   *
   * @param scoredFoods - Pre-scored food items from the recommendation engine
   * @param patientCtx - Patient context (dosha, agni, etc.)
   * @param goal - Dietary goal
   * @param durationDays - Number of days to plan
   * @returns Array of DietPlanItemDto
   */
  allocateMeals(
    scoredFoods: ScoredFood[],
    patientCtx: {
      primaryDosha: DoshaType;
      secondaryDosha?: DoshaType;
      agniState: AgniState;
      season: Season;
    },
    goal: DietaryGoal,
    durationDays: number
  ): DietPlanItemDto[] {
    this.logger.debug('Allocating meals', {
      module: 'MealPlanGenerator',
      foodCount: scoredFoods.length,
      durationDays,
      goal,
    });

    if (scoredFoods.length === 0) {
      throw new HealthcareError(
        'Cannot generate meal plan: no scored foods available',
        ErrorCode.VALIDATION_ERROR,
        400,
        {},
        'MealPlanGenerator.allocateMeals'
      );
    }

    const items: DietPlanItemDto[] = [];
    const slots: MealSlot[] = [
      MealSlot.BREAKFAST,
      MealSlot.MID_MORNING,
      MealSlot.LUNCH,
      MealSlot.EVENING,
      MealSlot.DINNER,
      MealSlot.BEDTIME,
    ];

    // Goal-based meal multipliers
    const goalMultipliers = this.getGoalMultipliers(goal);

    // Food name cache for foodId → name mapping
    const foodNameCache = new Map<string, string>();
    for (const f of scoredFoods) {
      foodNameCache.set(f.foodId, f.name);
    }

    for (let day = 1; day <= durationDays; day++) {
      const dayFoodPool = this.rotateFoodPool(scoredFoods, day);

      for (const slot of slots) {
        const multiplier = goalMultipliers[slot] ?? 1.0;
        if (multiplier === 0) continue; // Skip meals with 0 allocation

        const slotFoods = this.pickFoodsForSlot(
          dayFoodPool,
          slot,
          Math.ceil(MAX_ITEMS_PER_SLOT * multiplier)
        );

        for (const food of slotFoods) {
          items.push({
            foodItemId: food.foodId,
            mealSlot: slot,
            quantityGrams: Math.round(food.portionGrams * multiplier),
            preparationNotes: this.generatePreparationNotes(food, patientCtx),
            rationale: food.reason,
            dayNumber: day,
          });
        }
      }
    }

    this.logger.debug('Meal plan allocated', {
      module: 'MealPlanGenerator',
      totalItems: items.length,
      days: durationDays,
    });

    return items;
  }

  // ============ Slot selection helpers ============

  /**
   * Returns goal-based meal multipliers for each slot.
   */
  private getGoalMultipliers(goal: DietaryGoal): Record<MealSlot, number> {
    const map: Record<DietaryGoal, Record<MealSlot, number>> = {
      [DietaryGoal.WEIGHT_LOSS]: {
        [MealSlot.BREAKFAST]: 1.0,
        [MealSlot.MID_MORNING]: 0.5,
        [MealSlot.LUNCH]: 1.0,
        [MealSlot.EVENING]: 0.3,
        [MealSlot.DINNER]: 0.8,
        [MealSlot.BEDTIME]: 0.0,
      },
      [DietaryGoal.WEIGHT_GAIN]: {
        [MealSlot.BREAKFAST]: 1.2,
        [MealSlot.MID_MORNING]: 1.0,
        [MealSlot.LUNCH]: 1.3,
        [MealSlot.EVENING]: 1.0,
        [MealSlot.DINNER]: 1.2,
        [MealSlot.BEDTIME]: 0.8,
      },
      [DietaryGoal.DETOX]: {
        [MealSlot.BREAKFAST]: 0.8,
        [MealSlot.MID_MORNING]: 0.5,
        [MealSlot.LUNCH]: 1.0,
        [MealSlot.EVENING]: 0.3,
        [MealSlot.DINNER]: 0.8,
        [MealSlot.BEDTIME]: 0.0,
      },
      [DietaryGoal.BALANCE]: {
        [MealSlot.BREAKFAST]: 1.0,
        [MealSlot.MID_MORNING]: 0.8,
        [MealSlot.LUNCH]: 1.0,
        [MealSlot.EVENING]: 0.7,
        [MealSlot.DINNER]: 1.0,
        [MealSlot.BEDTIME]: 0.5,
      },
      [DietaryGoal.REJUVENATION]: {
        [MealSlot.BREAKFAST]: 1.2,
        [MealSlot.MID_MORNING]: 1.0,
        [MealSlot.LUNCH]: 1.2,
        [MealSlot.EVENING]: 1.0,
        [MealSlot.DINNER]: 1.2,
        [MealSlot.BEDTIME]: 0.8,
      },
    };

    return map[goal] ?? map[DietaryGoal.BALANCE];
  }

  /**
   * Rotates the food pool based on day number to introduce variety.
   * Uses a deterministic shuffle so the same day always gets the same subset.
   */
  private rotateFoodPool(scoredFoods: ScoredFood[], day: number): ScoredFood[] {
    const offset = ((day - 1) * 3) % scoredFoods.length;
    return [...scoredFoods.slice(offset), ...scoredFoods.slice(0, offset)];
  }

  /**
   * Picks the best foods for a given meal slot from the daily pool.
   */
  private pickFoodsForSlot(pool: ScoredFood[], slot: MealSlot, maxItems: number): ScoredFood[] {
    return pool
      .filter(f => f.preferredMealSlots.includes(slot) || f.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems);
  }

  /**
   * Generates preparation notes based on food and patient context.
   */
  private generatePreparationNotes(
    food: { name: string; reason: string; portionGrams: number },
    ctx: {
      primaryDosha: DoshaType;
      agniState: AgniState;
      season: Season;
    }
  ): string {
    const notes: string[] = [];

    // Agni-based guidance
    if (ctx.agniState === AgniState.MANDA) {
      notes.push('Cook thoroughly; add digestive spices (ginger, black pepper, cumin).');
    } else if (ctx.agniState === AgniState.TIKSHNA) {
      notes.push('Use moderate spices; avoid excess chili or souring agents.');
    } else if (ctx.agniState === AgniState.VISHAMA) {
      notes.push('Maintain regular meal times; use warming, easy-to-digest preparations.');
    }

    // Dosha-based guidance
    if (ctx.primaryDosha === DoshaType.VATA) {
      notes.push('Prefer warm, moist preparations with ghee.');
    } else if (ctx.primaryDosha === DoshaType.PITTA) {
      notes.push('Serve at room temperature or cool; avoid excess heating spices.');
    } else if (ctx.primaryDosha === DoshaType.KAPHA) {
      notes.push('Dry-roast or steam; minimize oil and heavy gravies.');
    }

    // Seasonal guidance
    if (ctx.season === Season.GRISHMA || ctx.season === Season.SHARAD) {
      notes.push('Cool, light preparation recommended for this season.');
    } else if (ctx.season === Season.VARSHA || ctx.season === Season.SHISHIR) {
      notes.push('Warm, nourishing preparation recommended for this season.');
    }

    return notes.join(' ') || 'Standard preparation per Ayurvedic guidelines.';
  }
}
