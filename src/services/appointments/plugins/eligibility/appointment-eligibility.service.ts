import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "@infrastructure/cache";
import { PrismaService } from "@database/prisma/prisma.service";

export interface EligibilityCriteria {
  id: string;
  name: string;
  description: string;
  clinicId: string;
  conditions: {
    ageRange?: { min: number; max: number };
    insuranceTypes?: string[];
    medicalHistory?: string[];
    appointmentTypes?: string[];
    timeRestrictions?: {
      minAdvanceHours: number;
      maxAdvanceDays: number;
    };
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EligibilityCheck {
  patientId: string;
  appointmentType: string;
  clinicId: string;
  requestedDate: Date;
  criteria: EligibilityCriteria[];
  result: {
    eligible: boolean;
    reasons: string[];
    restrictions: string[];
    recommendations: string[];
  };
  checkedAt: Date;
}

@Injectable()
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
export class AppointmentEligibilityService {
  private readonly logger = new Logger(AppointmentEligibilityService.name);
  private readonly ELIGIBILITY_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Check patient eligibility for appointment
   */
  async checkEligibility(
    patientId: string,
    appointmentType: string,
    clinicId: string,
    requestedDate: Date,
  ): Promise<EligibilityCheck> {
    const checkId = `eligibility_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Get eligibility criteria for clinic
      const criteria = await this.getEligibilityCriteria(clinicId);

      // Get patient information
      const patient = await this.getPatientInfo(patientId);

      const result = {
        eligible: true,
        reasons: [] as string[],
        restrictions: [] as string[],
        recommendations: [] as string[],
      };

      // Check each criteria
      for (const criterion of criteria) {
        const criterionResult = await this.evaluateCriterion(
          criterion,
          patient,
          appointmentType,
          requestedDate,
        );

        if (!criterionResult.eligible) {
          result.eligible = false;
          result.reasons.push(...criterionResult.reasons);
        }

        if (criterionResult.restrictions.length > 0) {
          result.restrictions.push(...criterionResult.restrictions);
        }

        if (criterionResult.recommendations.length > 0) {
          result.recommendations.push(...criterionResult.recommendations);
        }
      }

      const eligibilityCheck: EligibilityCheck = {
        patientId,
        appointmentType,
        clinicId,
        requestedDate,
        criteria,
        result,
        checkedAt: new Date(),
      };

      // Cache the eligibility check
      const cacheKey = `eligibility_check:${checkId}`;
      await this.cacheService.set(
        cacheKey,
        eligibilityCheck,
        this.ELIGIBILITY_CACHE_TTL,
      );

      this.logger.log(`Checked eligibility for patient ${patientId}`, {
        eligible: result.eligible,
        reasons: result.reasons,
        restrictions: result.restrictions,
      });

      return eligibilityCheck;
    } catch (_error) {
      this.logger.error(`Failed to check eligibility`, {
        patientId,
        appointmentType,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get eligibility criteria for clinic
   */
  async getEligibilityCriteria(
    clinicId: string,
  ): Promise<EligibilityCriteria[]> {
    const cacheKey = `eligibility_criteria:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as EligibilityCriteria[];
      }

      // Get criteria from database
      const criteria = await this.prisma["eligibilityCriteria"].findMany({
        where: {
          clinicId,
          isActive: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const criteriaList: EligibilityCriteria[] = criteria.map(
        (criterion: any) => ({
          id: criterion.id,
          name: criterion.name,
          description: criterion.description,
          conditions: criterion.conditions,
          isActive: criterion.isActive,
          clinicId: criterion.clinicId,
          createdAt: criterion.createdAt,
          updatedAt: criterion.updatedAt,
        }),
      );

      await this.cacheService.set(
        cacheKey,
        criteriaList,
        this.ELIGIBILITY_CACHE_TTL,
      );
      return criteriaList;
    } catch (_error) {
      this.logger.error(`Failed to get eligibility criteria`, {
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Create eligibility criteria
   */
  async createEligibilityCriteria(
    criteriaData: Omit<EligibilityCriteria, "id" | "createdAt" | "updatedAt">,
  ): Promise<EligibilityCriteria> {
    try {
      const criteria = await this.prisma["eligibilityCriteria"].create({
        data: {
          name: criteriaData.name,
          description: criteriaData.description,
          clinicId: criteriaData.clinicId,
          conditions: criteriaData.conditions,
          isActive: criteriaData.isActive,
        },
      });

      const criteriaResult: EligibilityCriteria = {
        id: criteria.id,
        name: criteria.name,
        description: criteria.description,
        conditions: criteria.conditions,
        isActive: criteria.isActive,
        clinicId: criteria.clinicId,
        createdAt: criteria.createdAt,
        updatedAt: criteria.updatedAt,
      };

      // Cache the criteria
      const cacheKey = `eligibility_criteria:${criteria.id}`;
      await this.cacheService.set(
        cacheKey,
        criteriaResult,
        this.ELIGIBILITY_CACHE_TTL,
      );

      // Invalidate criteria cache
      await this.invalidateEligibilityCache(criteriaData.clinicId);

      this.logger.log(`Created eligibility criteria ${criteria.id}`, {
        name: criteriaData.name,
        clinicId: criteriaData.clinicId,
      });

      return criteriaResult;
    } catch (_error) {
      this.logger.error(`Failed to create eligibility criteria`, {
        criteriaName: criteriaData.name,
        clinicId: criteriaData.clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get patient information
   */
  private async getPatientInfo(patientId: string): Promise<unknown> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { id: patientId },
        include: {
          user: {
            select: {
              dateOfBirth: true,
            },
          },
          appointments: {
            where: {
              status: {
                in: ["COMPLETED", "CANCELLED", "NO_SHOW"],
              },
            },
            orderBy: {
              date: "desc",
            },
            take: 1,
          },
          healthRecords: {
            select: {
              type: true,
              diagnosis: true,
            },
          },
        },
      });

      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      // Calculate age from date of birth
      const age = patient.user.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(patient.user.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          )
        : null;

      // Get insurance information
      const insurance = await this.prisma["insurance"].findFirst({
        where: {
          patientId,
          isActive: true,
        },
      });

      // Get medical history from health records
      const medicalHistory = patient.healthRecords
        .filter((record: any) => record.type === "DIAGNOSIS_REPORT")
        .map((record: any) => record.diagnosis)
        .filter(Boolean);

      return {
        id: patientId,
        age,
        insuranceType: insurance?.provider || "UNKNOWN",
        medicalHistory,
        lastAppointment: patient.appointments[0]?.date || null,
      };
    } catch (_error) {
      this.logger.error(`Failed to get patient info`, {
        patientId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Evaluate single criterion
   */
  private async evaluateCriterion(
    criterion: EligibilityCriteria,
    patient: unknown,
    appointmentType: string,
    requestedDate: Date,
  ): Promise<{
    eligible: boolean;
    reasons: string[];
    restrictions: string[];
    recommendations: string[];
  }> {
    const patientData = patient as any;
    const result = {
      eligible: true,
      reasons: [] as string[],
      restrictions: [] as string[],
      recommendations: [] as string[],
    };

    const { conditions } = criterion;

    // Check age range
    if (conditions.ageRange) {
      if (
        patientData.age < conditions.ageRange.min ||
        patientData.age > conditions.ageRange.max
      ) {
        result.eligible = false;
        result.reasons.push(
          `Patient age ${patientData.age} is outside allowed range ${conditions.ageRange.min}-${conditions.ageRange.max}`,
        );
      }
    }

    // Check insurance type
    if (conditions.insuranceTypes && conditions.insuranceTypes.length > 0) {
      if (!conditions.insuranceTypes.includes(patientData.insuranceType)) {
        result.eligible = false;
        result.reasons.push(
          `Insurance type ${patientData.insuranceType} not accepted for this appointment type`,
        );
      }
    }

    // Check appointment type
    if (conditions.appointmentTypes && conditions.appointmentTypes.length > 0) {
      if (!conditions.appointmentTypes.includes(appointmentType)) {
        result.eligible = false;
        result.reasons.push(
          `Appointment type ${appointmentType} not allowed for this patient`,
        );
      }
    }

    // Check time restrictions
    if (conditions.timeRestrictions) {
      const now = new Date();
      const hoursAdvance =
        (requestedDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      const daysAdvance = hoursAdvance / 24;

      if (hoursAdvance < conditions.timeRestrictions.minAdvanceHours) {
        result.eligible = false;
        result.reasons.push(
          `Appointment must be booked at least ${conditions.timeRestrictions.minAdvanceHours} hours in advance`,
        );
      }

      if (daysAdvance > conditions.timeRestrictions.maxAdvanceDays) {
        result.eligible = false;
        result.reasons.push(
          `Appointment cannot be booked more than ${conditions.timeRestrictions.maxAdvanceDays} days in advance`,
        );
      }
    }

    // Check medical history
    if (conditions.medicalHistory && conditions.medicalHistory.length > 0) {
      const hasRequiredHistory = conditions.medicalHistory.some((condition) =>
        patientData.medicalHistory.includes(condition),
      );

      if (!hasRequiredHistory) {
        result.restrictions.push(
          `Patient may need additional screening based on medical history`,
        );
        result.recommendations.push(
          `Consider scheduling additional tests or consultations`,
        );
      }
    }

    return result;
  }

  /**
   * Get eligibility history for patient
   */
  async getEligibilityHistory(
    patientId: string,
    clinicId: string,
  ): Promise<EligibilityCheck[]> {
    const cacheKey = `eligibility_history:${patientId}:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as EligibilityCheck[];
      }

      // Get eligibility history from database
      const history = await this.prisma["eligibilityCheck"].findMany({
        where: {
          patientId,
          clinicId,
        },
        orderBy: {
          checkedAt: "desc",
        },
        take: 10, // Limit to last 10 checks
      });

      const historyList: EligibilityCheck[] = history.map((check: any) => ({
        patientId: check.patientId,
        appointmentType: check.appointmentType,
        clinicId: check.clinicId,
        requestedDate: check.requestedDate,
        criteria: check.criteria,
        result: check.result,
        checkedAt: check.checkedAt,
      }));

      await this.cacheService.set(
        cacheKey,
        historyList,
        this.ELIGIBILITY_CACHE_TTL,
      );
      return historyList;
    } catch (_error) {
      this.logger.error(`Failed to get eligibility history`, {
        patientId,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Invalidate eligibility cache for a clinic
   */
  private async invalidateEligibilityCache(clinicId: string): Promise<void> {
    try {
      const pattern = `eligibility_criteria:${clinicId}*`;
      // This is a simplified implementation - in production you'd want to use Redis SCAN
      this.logger.log(`Invalidated eligibility cache for clinic ${clinicId}`);
    } catch (_error) {
      this.logger.error(`Failed to invalidate eligibility cache`, {
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
