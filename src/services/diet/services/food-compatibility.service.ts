/**
 * Food Compatibility Service — Viruddhahara rules engine
 * @module Diet/FoodCompatibility
 * @description Evaluates whether pairs of foods are compatible per Ayurvedic principles
 *
 * References: Charaka Samhita (Sutrasthana 26/27), Ashtanga Hridaya (Sutrasthana 7)
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { HealthcareError, ErrorCode } from '@core/errors';
import type {
  CheckCompatibilityDto,
  CompatibilityCheckResponseDto,
  CompatibilityViolationDto,
  FoodItemResponseDto,
  CompatibilitySeverity,
} from '@services/diet/dto';
import {
  FoodCategory,
  DoshaType,
  CompatibilitySeverity as Severity,
  Rasa,
  Virya,
  Vipaka,
} from '@services/diet/dto';

const COMPATIBILITY_CACHE_PREFIX = 'diet:compatibility';
const RULE_SEP = '::';

const FALLBACK_RULES: Record<
  string,
  { severity: CompatibilitySeverity; description: string; classicalRef?: string }
> = {
  [`${FoodCategory.SUKHA_AHARA}|${FoodCategory.ASUKHA_AHARA}`]: {
    severity: Severity.CONTRAINDICATED,
    description:
      'Fish should not be consumed with dairy. Viruddhahara per Charaka Samhita (Sutra 26).',
    classicalRef: 'Charaka Samhita, Sutra 26',
  },
  [`${FoodCategory.SUKHA_AHARA}|${FoodCategory.SUKHA_AHARA}`]: {
    severity: Severity.HIGH,
    description: 'Equal quantities of honey and ghee together produce toxic effects.',
    classicalRef: 'Ashtanga Hridaya, Sutra 7:35',
  },
  [`${FoodCategory.SATMYA_ASATMYA}|${FoodCategory.SUKHA_AHARA}`]: {
    severity: Severity.MODERATE,
    description: 'Cold water after hot food dampens Agni and impairs digestion.',
    classicalRef: 'Charaka Samhita, Sutra 27',
  },
};

/**
 * Service for evaluating Ayurvedic food compatibility (Viruddhahara).
 *
 * Checks pairs of foods against classical Ayurvedic incompatibility rules
 * and provides severity ratings and classical references.
 *
 * @public
 */
@Injectable()
export class FoodCompatibilityService {
  /**
   * Creates an instance of FoodCompatibilityService.
   * @param db - Database service for food catalog access
   * @param logger - Structured logging service
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggingService
  ) {}

  /**
   * Checks whether two foods are compatible per Ayurvedic principles.
   *
   * Evaluates:
   * 1. Dynamically loaded `FoodCompatibilityRule` rows from the database.
   * 2. In-memory fallback rules (Charaka / Ashtanga canonical pairs).
   * 3. Dosha-specific warnings (e.g. Kapha-aggravating + Kapha food).
   *
   * @param dto - Compatibility check parameters
   * @returns Detailed compatibility verdict with violations
   */
  async checkCompatibility(dto: CheckCompatibilityDto): Promise<CompatibilityCheckResponseDto> {
    const { foodItemIdA, foodItemIdB, patientId } = dto;

    // Look up food items (cache key = sorted IDs)
    const [foodA, foodB] = await this.getFoodItems(foodItemIdA, foodItemIdB);

    if (!foodA || !foodB) {
      throw new HealthcareError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'One or both food items not found',
        404,
        { foodItemIdA, foodItemIdB },
        'FoodCompatibilityService.checkCompatibility'
      );
    }

    const cacheKey = `${COMPATIBILITY_CACHE_PREFIX}:${RULESORT(foodItemIdA, foodItemIdB)}`;
    const _cacheKey = cacheKey; // reserved for future CacheService hookup
    void _cacheKey;

    const violations = await this.evaluateAllRules(foodA, foodB);

    if (patientId) {
      const patientViolations = await this.evaluatePatientSpecificRules(foodA, foodB, patientId);
      violations.push(...patientViolations);
    }

    const isCompatible = violations.every(v => v.severity === Severity.LOW);

    this.logger.debug('Compatibility check completed', {
      module: 'FoodCompatibility',
      foodA: foodA.name,
      foodB: foodB.name,
      violationsFound: violations.length,
      isCompatible,
    });

    return {
      isCompatible,
      violations,
      foodA: foodA.name,
      foodB: foodB.name,
    };
  }

  /**
   * Finds all foods that are incompatible with a given food item.
   * Returns food IDs + violation details.
   *
   * @param foodItemId - Food to find incompatible pairings for
   * @returns Array of incompatible foods with violation info
   */
  async findIncompatibleWith(
    foodItemId: string
  ): Promise<
    Array<{ foodItemId: string; foodName: string; violations: CompatibilityViolationDto[] }>
  > {
    const food = await this.db.prisma.foodItem.findUnique({
      where: { id: foodItemId },
    });

    if (!food) {
      throw new HealthcareError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Food item not found',
        404,
        { foodItemId },
        'FoodCompatibilityService.findIncompatibleWith'
      );
    }

    const allFoods = await this.db.prisma.foodItem.findMany({
      where: { isActive: true },
      select: { id: true, name: true, category: true, pacifies: true, aggravates: true },
    });

    const results: Array<{
      foodItemId: string;
      foodName: string;
      violations: CompatibilityViolationDto[];
    }> = [];

    for (const other of allFoods) {
      if (other.id === foodItemId) continue;

      const rawA = this.mapFoodRow(food);
      const rawB = this.mapFoodRow(other);

      const violations = await this.evaluateAllRules(rawA, rawB);
      if (violations.length > 0) {
        results.push({
          foodItemId: other.id,
          foodName: other.name,
          violations,
        });
      }
    }

    return results;
  }

  // ============ Private helpers ============

  /**
   * Fetches two food items (cached in a single query via findMany)
   */
  private async getFoodItems(
    idA: string,
    idB: string
  ): Promise<[FoodItemResponseDto | null, FoodItemResponseDto | null]> {
    const rows = await this.db.prisma.foodItem.findMany({
      where: { id: { in: [idA, idB] } },
    });

    const map = new Map<string, FoodItemResponseDto>(
      rows.map((r: (typeof rows)[number]) => [r.id, this.mapFoodRow(r)])
    );
    return [map.get(idA) ?? null, map.get(idB) ?? null];
  }

  /**
   * Evaluates all rule layers for a pair of foods.
   */
  private async evaluateAllRules(
    foodA: FoodItemResponseDto,
    foodB: FoodItemResponseDto
  ): Promise<CompatibilityViolationDto[]> {
    const violations: CompatibilityViolationDto[] = [];

    // Layer 1: DB-stored rules
    const dbRules = await this.fetchDbRules(foodA.id, foodB.id);
    violations.push(...dbRules);

    // Layer 2: Fallback rules
    const fallbackKey = buildFallbackKey(foodA.category, foodB.category);
    const fallbackRule = FALLBACK_RULES[fallbackKey];
    if (fallbackRule) {
      violations.push({
        ruleId: `fallback:${fallbackKey}`,
        severity: fallbackRule.severity,
        description: fallbackRule.description,
        ...(fallbackRule.classicalRef ? { classicalReference: fallbackRule.classicalRef } : {}),
      });
    }

    // Layer 3: Dosha-agnostic cross-dosha aggravation
    const doshaViolations = this.evaluateDoshaAggravation(foodA, foodB);
    violations.push(...doshaViolations);

    return violations;
  }

  /**
   * Loads explicit FoodCompatibilityRule rows from DB.
   */
  private async fetchDbRules(idA: string, idB: string): Promise<CompatibilityViolationDto[]> {
    // Sort IDs to support bi-directional rules (A+B == B+A)
    const sorted = RULESORT(idA, idB);
    const [sortedA, sortedB] = sorted.split(RULE_SEP);

    const rules = await this.db.prisma.foodCompatibilityRule.findMany({
      where: {
        OR: [
          { foodItemIdA: sortedA, foodItemIdB: sortedB },
          { foodItemIdA: sortedB, foodItemIdB: sortedA },
        ],
      },
    });

    return rules.map(
      (r: {
        id: string;
        severity: CompatibilitySeverity;
        description: string;
        classicalReference?: string | null;
      }) => ({
        ruleId: r.id,
        severity: r.severity as CompatibilitySeverity,
        description: r.description,
        classicalReference: r.classicalReference ?? undefined,
      })
    );
  }

  /**
   * Detects when both foods share an aggravating dosha for the patient.
   */
  private async evaluatePatientSpecificRules(
    foodA: FoodItemResponseDto,
    foodB: FoodItemResponseDto,
    patientId: string
  ): Promise<CompatibilityViolationDto[]> {
    const violations: CompatibilityViolationDto[] = [];

    // Get the patient's latest PrakritiAnalysis
    const prakriti = await this.db.prisma.prakritiAnalysis.findFirst({
      where: { patientId },
      orderBy: { assessedAt: 'desc' },
      select: { primaryDosha: true, secondaryDosha: true },
    });

    if (!prakriti) return violations;

    const patientDoshas = new Set<DoshaType>([
      prakriti.primaryDosha as DoshaType,
      ...(prakriti.secondaryDosha ? [prakriti.secondaryDosha as DoshaType] : []),
    ]);

    for (const dosha of patientDoshas) {
      const aggravatesA = foodA.aggravates ?? [];
      const aggravatesB = foodB.aggravates ?? [];
      if (aggravatesA.includes(dosha) && aggravatesB.includes(dosha)) {
        violations.push({
          ruleId: `patient-prakriti:${dosha}`,
          severity: Severity.MODERATE,
          description: `Both ${foodA.name} and ${foodB.name} aggravate ${dosha}. For a ${dosha} patient, combining them may amplify imbalance.`,
        });
      }
    }

    return violations;
  }

  /**
   * Detects cross-dosha aggravation: a food that pacifies one dosha may
   * aggravate another; combining two such foods can destabilize both.
   */
  private evaluateDoshaAggravation(
    foodA: FoodItemResponseDto,
    foodB: FoodItemResponseDto
  ): CompatibilityViolationDto[] {
    const violations: CompatibilityViolationDto[] = [];
    const doshas: DoshaType[] = [DoshaType.VATA, DoshaType.PITTA, DoshaType.KAPHA];

    for (const dosha of doshas) {
      const aPacifies = foodA.pacifies?.includes(dosha) ?? false;
      const aAggravates = foodA.aggravates?.includes(dosha) ?? false;
      const bPacifies = foodB.pacifies?.includes(dosha) ?? false;
      const bAggravates = foodB.aggravates?.includes(dosha) ?? false;

      // One pacifies, the other aggravates the same dosha
      if ((aPacifies && bAggravates) || (aAggravates && bPacifies)) {
        violations.push({
          ruleId: `dosha-cross:${dosha}`,
          severity: Severity.LOW,
          description: `${foodA.name} and ${foodB.name} have opposing effects on ${dosha}. Co-consuming may cause minor dosha instability.`,
        });
      }
    }

    return violations;
  }

  /**
   * Maps a raw Prisma foodItem row to the response DTO
   */
  private mapFoodRow(row: {
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
  }): FoodItemResponseDto {
    return {
      id: row.id,
      name: row.name,
      sanskritName: row.sanskritName ?? undefined,
      category: row.category as FoodCategory,
      primaryRasa: row.primaryRasa as Rasa,
      secondaryRasas: row.secondaryRasas as Rasa[] | undefined,
      virya: row.virya as Virya,
      vipaka: row.vipaka as Vipaka,
      pacifies: row.pacifies as DoshaType[] | undefined,
      aggravates: row.aggravates as DoshaType[] | undefined,
      description: row.description ?? undefined,
      defaultPortionGrams: row.defaultPortionGrams ?? undefined,
      tags: row.tags as string[] | undefined,
      createdAt: '', // not needed for rule evaluation
    };
  }

  /**
   * Returns the highest severity among violations, defaulting to LOW
   */
  private getHighestSeverity(violations: CompatibilityViolationDto[]): CompatibilitySeverity {
    if (violations.length === 0) return Severity.LOW;

    const order: Record<CompatibilitySeverity, number> = {
      [Severity.LOW]: 0,
      [Severity.MODERATE]: 1,
      [Severity.HIGH]: 2,
      [Severity.CONTRAINDICATED]: 3,
    };

    let highest: CompatibilitySeverity = Severity.LOW;
    for (const violation of violations) {
      if (order[violation.severity] > order[highest]) {
        highest = violation.severity;
      }
    }
    return highest;
  }
}

/**
 * Helper: canonical rule key (sorted IDs, separator)
 */
function RULESORT(a: string, b: string): string {
  return a < b ? `${a}${RULE_SEP}${b}` : `${b}${RULE_SEP}${a}`;
}

/**
 * Helper: build fallback key from category enums
 */
function buildFallbackKey(catA: string, catB: string): string {
  return [catA, catB].sort().join('|');
}
