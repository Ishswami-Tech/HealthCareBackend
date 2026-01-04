import { Injectable } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { EligibilityCriteria, EligibilityCheck } from '@core/types/appointment.types';

@Injectable()
export class AppointmentEligibilityService {
  private readonly ELIGIBILITY_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Check patient eligibility for appointment
   */
  async checkEligibility(
    patientId: string,
    appointmentType: string,
    clinicId: string,
    requestedDate: Date
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
          requestedDate
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
      await this.cacheService.set(cacheKey, eligibilityCheck, this.ELIGIBILITY_CACHE_TTL);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Checked eligibility for patient ${patientId}`,
        'AppointmentEligibilityService',
        {
          eligible: result.eligible,
          reasons: result.reasons,
          restrictions: result.restrictions,
        }
      );

      return eligibilityCheck;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check eligibility`,
        'AppointmentEligibilityService',
        {
          patientId,
          appointmentType,
          clinicId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Get eligibility criteria for clinic
   */
  async getEligibilityCriteria(clinicId: string): Promise<EligibilityCriteria[]> {
    const cacheKey = `eligibility_criteria:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as EligibilityCriteria[];
      }

      // Get criteria from database using executeHealthcareRead
      const criteria = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            eligibilityCriteria: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).eligibilityCriteria.findMany({
          where: {
            clinicId,
            isActive: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        } as never);
      });

      interface EligibilityCriteriaRow {
        id: string;
        name: string;
        description: string;
        conditions: unknown;
        isActive: boolean;
        clinicId: string;
        createdAt: Date;
        updatedAt: Date;
      }

      const criteriaList: EligibilityCriteria[] = criteria.map((criterion: unknown) => {
        const row = criterion as EligibilityCriteriaRow;
        return {
          id: row.id,
          name: row.name,
          description: row.description,
          conditions: row.conditions as EligibilityCriteria['conditions'],
          isActive: row.isActive,
          clinicId: row.clinicId,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      await this.cacheService.set(cacheKey, criteriaList, this.ELIGIBILITY_CACHE_TTL);
      return criteriaList;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get eligibility criteria`,
        'AppointmentEligibilityService',
        {
          clinicId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Create eligibility criteria
   */
  async createEligibilityCriteria(
    criteriaData: Omit<EligibilityCriteria, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<EligibilityCriteria> {
    try {
      // Use executeHealthcareWrite for create operation
      const criteria = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              eligibilityCriteria: {
                create: <T>(args: T) => Promise<unknown>;
              };
            }
          ).eligibilityCriteria.create({
            data: {
              name: criteriaData.name,
              description: criteriaData.description,
              clinicId: criteriaData.clinicId,
              conditions: criteriaData.conditions,
              isActive: criteriaData.isActive,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: criteriaData.clinicId || '',
          resourceType: 'ELIGIBILITY_CRITERIA',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: criteriaData.name },
        }
      );

      const criteriaResult = criteria as {
        id: string;
        name: string;
        description: string;
        conditions: unknown;
        isActive: boolean;
        clinicId: string;
        createdAt: Date;
        updatedAt: Date;
      };

      // Cache the criteria
      const cacheKey = `eligibility_criteria:${criteriaResult.id}`;
      await this.cacheService.set(cacheKey, criteriaResult, this.ELIGIBILITY_CACHE_TTL);

      // Invalidate criteria cache
      await this.invalidateEligibilityCache(criteriaData.clinicId);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Created eligibility criteria ${criteriaResult.id}`,
        'AppointmentEligibilityService',
        {
          name: criteriaData.name,
          clinicId: criteriaData.clinicId,
        }
      );

      return criteriaResult as EligibilityCriteria;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create eligibility criteria`,
        'AppointmentEligibilityService',
        {
          criteriaName: criteriaData.name,
          clinicId: criteriaData.clinicId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Get patient information
   */
  private async getPatientInfo(patientId: string): Promise<unknown> {
    try {
      // Use executeHealthcareRead (patient query was already fixed earlier but this is a duplicate - keep the pattern)
      const patient = await this.databaseService.executeHealthcareRead(async client => {
        const patientDelegate = client['patient'] as {
          findUnique: (args: { where: { id: string }; include?: unknown }) => Promise<unknown>;
        };
        return await patientDelegate.findUnique({
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
                  in: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
                },
              },
              orderBy: {
                date: 'desc',
              },
              take: 1,
            },
            healthRecords: {
              select: {
                recordType: true,
                report: true,
              },
            },
          },
        });
      });

      if (!patient) {
        throw new Error(`Patient not found: ${patientId}`);
      }

      // Calculate age from date of birth
      const patientWithUser = patient as {
        user: {
          dateOfBirth: Date | null;
        };
        healthRecords: Array<{ recordType?: string; report?: string | null }>;
        appointments: Array<{ date: Date }>;
      };
      const age = patientWithUser.user.dateOfBirth
        ? Math.floor(
            (Date.now() - new Date(patientWithUser.user.dateOfBirth).getTime()) /
              (365.25 * 24 * 60 * 60 * 1000)
          )
        : null;

      // Get insurance information using executeHealthcareRead
      const insurance = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            insurance: {
              findFirst: <T>(args: T) => Promise<{ provider?: string } | null>;
            };
          }
        ).insurance.findFirst({
          where: {
            patientId,
            isActive: true,
          },
        } as never);
      });

      // Get medical history from health records
      const medicalHistory = (patientWithUser.healthRecords || [])
        .filter(record => record.recordType === 'DIAGNOSIS_REPORT')
        .map(record => record.report)
        .filter((report): report is string => report !== null && report !== undefined);

      return {
        id: patientId,
        age,
        insuranceType: insurance?.provider || 'UNKNOWN',
        medicalHistory,
        lastAppointment: patientWithUser.appointments[0]?.date || null,
      };
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient info`,
        'AppointmentEligibilityService',
        {
          patientId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Evaluate single criterion
   */
  private evaluateCriterion(
    criterion: EligibilityCriteria,
    patient: unknown,
    appointmentType: string,
    requestedDate: Date
  ): Promise<{
    eligible: boolean;
    reasons: string[];
    restrictions: string[];
    recommendations: string[];
  }> {
    // Define interface for patient data structure
    interface PatientData {
      age?: number;
      insuranceType?: string;
      medicalHistory?: string[];
      [key: string]: unknown;
    }

    const patientData = patient as PatientData;
    const result = {
      eligible: true,
      reasons: [] as string[],
      restrictions: [] as string[],
      recommendations: [] as string[],
    };

    const { conditions } = criterion;

    // Check age range
    if (conditions.ageRange && patientData.age !== undefined) {
      if (patientData.age < conditions.ageRange.min || patientData.age > conditions.ageRange.max) {
        result.eligible = false;
        result.reasons.push(
          `Patient age ${patientData.age} is outside allowed range ${conditions.ageRange.min}-${conditions.ageRange.max}`
        );
      }
    }

    // Check insurance type
    if (
      conditions.insuranceTypes &&
      conditions.insuranceTypes.length > 0 &&
      patientData.insuranceType
    ) {
      if (!conditions.insuranceTypes.includes(patientData.insuranceType)) {
        result.eligible = false;
        result.reasons.push(
          `Insurance type ${patientData.insuranceType} not accepted for this appointment type`
        );
      }
    }

    // Check appointment type
    if (conditions.appointmentTypes && conditions.appointmentTypes.length > 0) {
      if (!conditions.appointmentTypes.includes(appointmentType)) {
        result.eligible = false;
        result.reasons.push(`Appointment type ${appointmentType} not allowed for this patient`);
      }
    }

    // Check time restrictions
    if (conditions.timeRestrictions) {
      const now = new Date();
      const hoursAdvance = (requestedDate.getTime() - now.getTime()) / (1000 * 60 * 60);
      const daysAdvance = hoursAdvance / 24;

      if (hoursAdvance < conditions.timeRestrictions.minAdvanceHours) {
        result.eligible = false;
        result.reasons.push(
          `Appointment must be booked at least ${conditions.timeRestrictions.minAdvanceHours} hours in advance`
        );
      }

      if (daysAdvance > conditions.timeRestrictions.maxAdvanceDays) {
        result.eligible = false;
        result.reasons.push(
          `Appointment cannot be booked more than ${conditions.timeRestrictions.maxAdvanceDays} days in advance`
        );
      }
    }

    // Check medical history
    if (
      conditions.medicalHistory &&
      conditions.medicalHistory.length > 0 &&
      patientData.medicalHistory
    ) {
      const hasRequiredHistory = conditions.medicalHistory.some(condition =>
        patientData.medicalHistory?.includes(condition)
      );

      if (!hasRequiredHistory) {
        result.restrictions.push(`Patient may need additional screening based on medical history`);
        result.recommendations.push(`Consider scheduling additional tests or consultations`);
      }
    }

    return Promise.resolve(result);
  }

  /**
   * Get eligibility history for patient
   */
  async getEligibilityHistory(patientId: string, clinicId: string): Promise<EligibilityCheck[]> {
    const cacheKey = `eligibility_history:${patientId}:${clinicId}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as EligibilityCheck[];
      }

      // Get eligibility history from database
      // Use executeHealthcareRead for eligibilityCheck
      const history = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            eligibilityCheck: {
              findMany: <T>(args: T) => Promise<unknown[]>;
            };
          }
        ).eligibilityCheck.findMany({
          where: {
            patientId,
            clinicId,
          },
          orderBy: {
            checkedAt: 'desc',
          },
          take: 10, // Limit to last 10 checks
        } as never);
      });

      interface EligibilityCheckRow {
        patientId: string;
        appointmentType: string;
        clinicId: string;
        requestedDate: Date;
        criteria: EligibilityCriteria[];
        result: EligibilityCheck['result'];
        checkedAt: Date;
      }

      const historyList: EligibilityCheck[] = history.map((check: unknown) => {
        const row = check as EligibilityCheckRow;
        return {
          patientId: row.patientId,
          appointmentType: row.appointmentType,
          clinicId: row.clinicId,
          requestedDate: row.requestedDate,
          criteria: row.criteria,
          result: row.result,
          checkedAt: row.checkedAt,
        };
      });

      await this.cacheService.set(cacheKey, historyList, this.ELIGIBILITY_CACHE_TTL);
      return historyList;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get eligibility history`,
        'AppointmentEligibilityService',
        {
          patientId,
          clinicId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Update eligibility criteria
   */
  async updateEligibilityCriteria(
    criteriaId: string,
    updateData: Partial<Omit<EligibilityCriteria, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<EligibilityCriteria> {
    try {
      // Use executeHealthcareWrite for update operation
      const criteria = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              eligibilityCriteria: {
                update: <T>(args: T) => Promise<unknown>;
                findUnique: <T>(args: T) => Promise<unknown>;
              };
            }
          ).eligibilityCriteria.update({
            where: { id: criteriaId },
            data: {
              ...(updateData.name && { name: updateData.name }),
              ...(updateData.description && { description: updateData.description }),
              ...(updateData.conditions && { conditions: updateData.conditions }),
              ...(updateData.isActive !== undefined && { isActive: updateData.isActive }),
              updatedAt: new Date(),
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: updateData.clinicId || '',
          resourceType: 'ELIGIBILITY_CRITERIA',
          operation: 'UPDATE',
          resourceId: criteriaId,
          userRole: 'system',
          details: { criteriaId, updateFields: Object.keys(updateData) },
        }
      );

      const criteriaResult = criteria as {
        id: string;
        name: string;
        description: string;
        conditions: unknown;
        isActive: boolean;
        clinicId: string;
        createdAt: Date;
        updatedAt: Date;
      };

      // Invalidate cache
      await this.invalidateEligibilityCache(criteriaResult.clinicId);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Updated eligibility criteria ${criteriaId}`,
        'AppointmentEligibilityService',
        {
          criteriaId,
          clinicId: criteriaResult.clinicId,
        }
      );

      return criteriaResult as EligibilityCriteria;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update eligibility criteria`,
        'AppointmentEligibilityService',
        {
          criteriaId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Delete eligibility criteria
   */
  async deleteEligibilityCriteria(criteriaId: string): Promise<boolean> {
    try {
      // First get the criteria to get clinicId for cache invalidation
      const existingCriteria = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            eligibilityCriteria: {
              findUnique: <T>(args: T) => Promise<unknown>;
            };
          }
        ).eligibilityCriteria.findUnique({
          where: { id: criteriaId },
          select: { clinicId: true },
        } as never);
      });

      const clinicId =
        existingCriteria && typeof existingCriteria === 'object' && 'clinicId' in existingCriteria
          ? (existingCriteria['clinicId'] as string)
          : '';

      // Use executeHealthcareWrite for delete operation
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              eligibilityCriteria: {
                delete: <T>(args: T) => Promise<unknown>;
              };
            }
          ).eligibilityCriteria.delete({
            where: { id: criteriaId },
          } as never);
        },
        {
          userId: 'system',
          clinicId,
          resourceType: 'ELIGIBILITY_CRITERIA',
          operation: 'DELETE',
          resourceId: criteriaId,
          userRole: 'system',
          details: { criteriaId },
        }
      );

      // Invalidate cache
      await this.invalidateEligibilityCache(clinicId);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Deleted eligibility criteria ${criteriaId}`,
        'AppointmentEligibilityService',
        {
          criteriaId,
          clinicId,
        }
      );

      return true;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete eligibility criteria`,
        'AppointmentEligibilityService',
        {
          criteriaId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Invalidate eligibility cache for a clinic
   */
  private async invalidateEligibilityCache(clinicId: string): Promise<void> {
    try {
      const _pattern = `eligibility_criteria:${clinicId}*`;
      // This is a simplified implementation - in production you'd want to use Redis SCAN
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Invalidated eligibility cache for clinic ${clinicId}`,
        'AppointmentEligibilityService'
      );
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate eligibility cache`,
        'AppointmentEligibilityService',
        {
          clinicId,
          _error: _error instanceof Error ? _error.message : String(_error),
        }
      );
    }
  }
}
