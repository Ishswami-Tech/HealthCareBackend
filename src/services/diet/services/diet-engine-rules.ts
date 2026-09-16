/**
 * Diet Engine Rules — Ayurvedic rule tables and scoring utilities
 * @module Diet/EngineRules
 * @description Shared constants and pure functions for the Diet Recommendation Engine
 */

import {
  DietaryGoal,
  MealSlot,
  DoshaType,
  AgniState,
  Season,
  FoodCategory,
  CompatibilitySeverity,
} from '@services/diet/dto';

/**
 * Per-dosha food preference table.
 * Positive = include (pacifies dosha); negative = avoid (aggravates dosha).
 */
export const DOSHA_PREFERENCE: Record<DoshaType, Record<string, number>> = {
  [DoshaType.VATA]: {
    warm_grain_porridge: 3,
    ghee: 3,
    root_vegetables: 3,
    warm_milk: 2,
    ginger: 2,
    sesame: 2,
    raw_salad: -3,
    cold_water: -2,
    popcorn: -2,
    crackers: -2,
  },
  [DoshaType.PITTA]: {
    cool_milk: 3,
    coconut_water: 3,
    bitter_gourd: 3,
    leafy_greens: 2,
    ghee: 1,
    aloe_vera: 2,
    hot_spices: -3,
    alcohol: -3,
    sour_fruits: -2,
    fried_food: -2,
  },
  [DoshaType.KAPHA]: {
    honey: 3,
    ginger_tea: 3,
    barley: 3,
    bitter_greens: 2,
    light_soups: 2,
    turmeric: 2,
    heavy_dairy: -3,
    fried_food: -3,
    sweets: -2,
    cold_food: -2,
  },
};

/**
 * Agni-state portion multiplier table
 */
export const AGNI_PORTION_MULTIPLIER: Record<AgniState, number> = {
  [AgniState.SAMA]: 1.0,
  [AgniState.VISHAMA]: 0.8,
  [AgniState.TIKSHNA]: 0.6,
  [AgniState.MANDA]: 0.7,
};

/**
 * Seasonal dosha aggravation — which doshas tend to be aggravated per season
 */
export const SEASONAL_AGGR: Record<Season, DoshaType[]> = {
  [Season.VASANT]: [DoshaType.KAPHA],
  [Season.GRISHMA]: [DoshaType.PITTA],
  [Season.VARSHA]: [DoshaType.VATA],
  [Season.SHARAD]: [DoshaType.PITTA],
  [Season.HEMANT]: [DoshaType.VATA],
  [Season.SHISHIR]: [DoshaType.VATA],
};

/**
 * Seasonal food keyword bonuses
 */
export const SEASONAL_FOODS: Record<Season, Record<string, number>> = {
  [Season.VASANT]: { bitter_greens: 1, honey: 1, light_grain: 1 },
  [Season.GRISHMA]: { cool_milk: 1, coconut_water: 1, fruits: 1 },
  [Season.VARSHA]: { warm_grain_porridge: 1, ginger: 1, warm_soups: 1 },
  [Season.SHARAD]: { bitter_gourd: 1, cool_foods: 1, coconut: 1 },
  [Season.HEMANT]: { warm_milk: 1, ghee: 1, root_vegetables: 1 },
  [Season.SHISHIR]: { ghee: 1, warm_soups: 1, sesame: 1 },
};

/**
 * Goal-based meal multipliers
 */
export const GOAL_MEAL_MULTIPLIERS: Record<DietaryGoal, Record<MealSlot, number>> = {
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

/**
 * Cache key prefix for engine results
 */
export const ENGINE_CACHE_PREFIX = 'diet:engine';

/**
 * Engine rule key separator
 */
export const RULE_SEP = '::';

/**
 * In-memory fallback Viruddhahara rules (Charaka / Ashtanga canonical)
 */
export const FALLBACK_VIRUDDHAHARA: Record<
  string,
  { severity: CompatibilitySeverity; description: string; classicalRef?: string }
> = {
  [`${FoodCategory.SUKHA_AHARA}|${FoodCategory.ASUKHA_AHARA}`]: {
    severity: CompatibilitySeverity.CONTRAINDICATED,
    description:
      'Fish should not be consumed with dairy. This combination is classified as Viruddhahara.',
    classicalRef: 'Charaka Samhita, Sutra 26',
  },
  [`${FoodCategory.SUKHA_AHARA}|${FoodCategory.SUKHA_AHARA}`]: {
    severity: CompatibilitySeverity.HIGH,
    description: 'Equal quantities of honey and ghee together produce toxic effects.',
    classicalRef: 'Ashtanga Hridaya, Sutra 7:35',
  },
  [`${FoodCategory.SATMYA_ASATMYA}|${FoodCategory.SUKHA_AHARA}`]: {
    severity: CompatibilitySeverity.MODERATE,
    description: 'Cold water after hot food can dampen Agni and lead to poor digestion.',
    classicalRef: 'Charaka Samhita, Sutra 27',
  },
};

/**
 * Returns a human-readable season label.
 */
export function getSeasonLabel(season: Season): string {
  return season.charAt(0) + season.slice(1).toLowerCase();
}

/**
 * Detects the current Ayurvedic season from the given date.
 */
export function detectCurrentSeason(date: Date): Season {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return Season.VASANT;
  if (month >= 6 && month <= 8) return Season.GRISHMA;
  if (month >= 9 && month <= 11) return Season.VARSHA;
  return Season.HEMANT;
}

/**
 * Builds a plan title from generation parameters.
 */
export function buildPlanTitle(goal: DietaryGoal): string {
  const date = new Date();
  return `${goal} Diet Plan — ${date.toLocaleDateString('en-IN')}`;
}

/**
 * Builds a human-readable summary for the plan header.
 */
export function buildSummary(
  primaryDosha: DoshaType,
  secondaryDosha: DoshaType | undefined,
  agniState: AgniState,
  season: Season,
  goal: DietaryGoal,
  itemCount: number
): string {
  const parts = [
    `Personalized ${goal} diet chart for ${primaryDosha}${secondaryDosha ? `/${secondaryDosha}` : ''} constitution.`,
    `Seasonal adjustment: ${getSeasonLabel(season)}.`,
    `Agni guidance: ${agniState}.`,
    `Total meals: ${itemCount}.`,
  ];
  return parts.join(' ');
}

/**
 * Lists rule identifiers that fired during generation.
 */
export function buildRulesFired(
  primaryDosha: DoshaType,
  secondaryDosha: DoshaType | undefined,
  agniState: AgniState,
  season: Season,
  goal: DietaryGoal
): string[] {
  const rules: string[] = [
    `dosha.primary:${primaryDosha}`,
    `goal:${goal}`,
    `agni:${agniState}`,
    `season:${season}`,
  ];
  if (secondaryDosha) rules.push(`dosha.secondary:${secondaryDosha}`);
  return rules;
}

/**
 * Canonical rule key (sorted IDs with separator)
 */
export function ruleKeySort(a: string, b: string): string {
  return a < b ? `${a}${RULE_SEP}${b}` : `${b}${RULE_SEP}${a}`;
}

/**
 * Build fallback lookup key from two category strings
 */
export function buildFallbackKey(catA: string, catB: string): string {
  return [catA, catB].sort().join('|');
}
