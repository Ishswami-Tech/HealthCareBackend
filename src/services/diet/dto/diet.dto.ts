/**
 * Diet Module DTOs
 * @module Diet/DTO
 * @description Data Transfer Objects for the Diet Chart Generator module
 *
 * Covers:
 * - Dosha-based dietary guidance enums (MealSlot, DietaryGoal, FoodCategory, Rasa, Virya, Vipaka)
 * - Generate Diet Chart request/response (rule-engine output)
 * - Diet Plan CRUD (header + items)
 * - Food catalog (FoodItem CRUD + listing with filters)
 * - Food compatibility (Viruddhahara lookup)
 */

/** Meal slot for a Diet Plan item */
export enum MealSlot {
  BREAKFAST = 'BREAKFAST',
  MID_MORNING = 'MID_MORNING',
  LUNCH = 'LUNCH',
  EVENING = 'EVENING',
  DINNER = 'DINNER',
  BEDTIME = 'BEDTIME',
}

/** Patient dietary objective */
export enum DietaryGoal {
  WEIGHT_LOSS = 'WEIGHT_LOSS',
  WEIGHT_GAIN = 'WEIGHT_GAIN',
  DETOX = 'DETOX',
  BALANCE = 'BALANCE',
  REJUVENATION = 'REJUVENATION',
}

/** Ayurvedic food category classification */
export enum FoodCategory {
  SUKHA_AHARA = 'SUKHA_AHARA',
  ASUKHA_AHARA = 'ASUKHA_AHARA',
  SATMYA_ASATMYA = 'SATMYA_ASATMYA',
}

/** Primary Ayurvedic taste (Rasa) */
export enum Rasa {
  MADHURA = 'MADHURA',
  AMLA = 'AMLA',
  LAVANA = 'LAVANA',
  KATU = 'KATU',
  TIKTA = 'TIKTA',
  KASHAYA = 'KASHAYA',
}

/** Potency (Virya) — heating or cooling effect on the body */
export enum Virya {
  USHNA = 'USHNA',
  SHEETA = 'SHEETA',
}

/** Post-digestive effect (Vipaka) */
export enum Vipaka {
  MADHURA = 'MADHURA',
  AMLA = 'AMLA',
  KATU = 'KATU',
}

/** Agni (digestive fire) state */
export enum AgniState {
  SAMA = 'SAMA',
  VISHAMA = 'VISHAMA',
  TIKSHNA = 'TIKSHNA',
  MANDA = 'MANDA',
}

/** Dosha types */
export enum DoshaType {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
}

/** Season for seasonal diet adjustments (Ritucharya) */
export enum Season {
  VASANT = 'VASANT',
  GRISHMA = 'GRISHMA',
  VARSHA = 'VARSHA',
  SHARAD = 'SHARAD',
  HEMANT = 'HEMANT',
  SHISHIR = 'SHISHIR',
}

/** Severity of a food compatibility violation */
export enum CompatibilitySeverity {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CONTRAINDICATED = 'CONTRAINDICATED',
}

/** Status of a diet plan */
export enum DietPlanStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  EXPIRED = 'EXPIRED',
}

// ============ Request DTOs ============

/**
 * Request to generate a fresh diet chart for a patient
 * @class GenerateDietChartDto
 */
export class GenerateDietChartDto {
  patientId!: string;
  goal!: DietaryGoal;
  primaryDosha?: DoshaType;
  secondaryDosha?: DoshaType;
  season?: Season;
  agniState?: AgniState;
  durationDays?: number;
  dietaryRestrictions?: string[];
  notes?: string;
}

/**
 * Item assigned to a specific meal slot in a Diet Plan
 * @class DietPlanItemDto
 */
export class DietPlanItemDto {
  foodItemId!: string;
  mealSlot!: MealSlot;
  quantityGrams!: number;
  preparationNotes?: string | undefined;
  rationale?: string | undefined;
  dayNumber?: number | undefined;
}

/**
 * Create a new Diet Plan (header + items)
 * @class CreateDietPlanDto
 */
export class CreateDietPlanDto {
  patientId!: string;
  title!: string;
  goal!: DietaryGoal;
  startDate!: string;
  endDate!: string;
  summary?: string;
  items?: DietPlanItemDto[];
  prakritiAnalysisId?: string;
}

/**
 * Update an existing Diet Plan
 * @class UpdateDietPlanDto
 */
export class UpdateDietPlanDto {
  title?: string;
  goal?: DietaryGoal;
  endDate?: string;
  status?: DietPlanStatus;
  summary?: string;
  items?: DietPlanItemDto[];
}

/**
 * Create a Food catalog entry
 * @class CreateFoodItemDto
 */
export class CreateFoodItemDto {
  name!: string;
  sanskritName?: string;
  category!: FoodCategory;
  primaryRasa!: Rasa;
  secondaryRasas?: Rasa[];
  virya!: Virya;
  vipaka!: Vipaka;
  pacifies?: DoshaType[];
  aggravates?: DoshaType[];
  description?: string;
  defaultPortionGrams?: number;
  tags?: string[];
}

/**
 * Food item response
 * @class FoodItemResponseDto
 */
export class FoodItemResponseDto {
  id!: string;
  name!: string;
  sanskritName?: string | undefined;
  category!: FoodCategory;
  primaryRasa!: Rasa;
  secondaryRasas?: Rasa[] | undefined;
  virya!: Virya;
  vipaka!: Vipaka;
  pacifies?: DoshaType[] | undefined;
  aggravates?: DoshaType[] | undefined;
  description?: string | undefined;
  defaultPortionGrams?: number | undefined;
  tags?: string[] | undefined;
  createdAt!: string;
}

/**
 * Viruddhahara rule lookup request
 * @class CheckCompatibilityDto
 */
export class CheckCompatibilityDto {
  foodItemIdA!: string;
  foodItemIdB!: string;
  patientId?: string;
}

/**
 * A single rule violation detected during compatibility check
 * @class CompatibilityViolationDto
 */
export class CompatibilityViolationDto {
  ruleId!: string;
  severity!: CompatibilitySeverity;
  description!: string;
  classicalReference?: string | undefined;
}

/**
 * Compatibility check response
 * @class CompatibilityCheckResponseDto
 */
export class CompatibilityCheckResponseDto {
  isCompatible!: boolean;
  violations!: CompatibilityViolationDto[];
  foodA!: string;
  foodB!: string;
}

// ============ Response DTOs ============

/**
 * Diet plan item response
 * @class DietPlanItemResponseDto
 */
export class DietPlanItemResponseDto {
  id!: string;
  dietPlanId!: string;
  foodItemId!: string;
  foodName?: string | undefined;
  mealSlot!: MealSlot;
  quantityGrams!: number;
  preparationNotes?: string | undefined;
  rationale?: string | undefined;
  dayNumber?: number | undefined;
}

/**
 * Diet plan response DTO
 * @class DietPlanResponseDto
 */
export class DietPlanResponseDto {
  id!: string;
  patientId!: string;
  clinicId!: string;
  title!: string;
  goal!: DietaryGoal;
  status!: DietPlanStatus;
  startDate!: string;
  endDate!: string;
  summary?: string | undefined;
  items!: DietPlanItemResponseDto[];
  prakritiAnalysisId?: string | undefined;
  createdBy!: string;
  createdAt!: string;
  updatedAt!: string;
}

/**
 * Diet Chart generation response (engine output)
 * @class GenerateDietChartResponseDto
 */
export class GenerateDietChartResponseDto {
  dietPlanId!: string;
  totalItems!: number;
  rulesFired!: string[];
  warnings!: CompatibilityViolationDto[];
  summary!: string;
}
