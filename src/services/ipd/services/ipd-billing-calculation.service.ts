/**
 * IPD Billing Charge Calculation
 * @module IPD Billing - Charge Calculation
 * @description Pure calculation logic for IPD bed charges
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { HealthcareError, ErrorCode } from '@core/errors';
import type { AccrueDailyChargesDto, BedChargeResponseDto } from '@services/ipd/dto';

/**
 * Service for IPD bed charge calculations.
 *
 * @public
 */
@Injectable()
export class IpdBillingCalculationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggingService
  ) {}

  /**
   * Calculates daily bed charges for an admission.
   *
   * @param admissionId - Admission ID
   * @param clinicId - Clinic context
   * @param chargeDate - Date to calculate for
   * @param userId - User accruing charges
   * @returns Calculated charges
   */
  async calculateDailyCharges(
    admissionId: string,
    clinicId: string,
    chargeDate: Date,
    userId: string
  ): Promise<Omit<BedChargeResponseDto, 'id'>> {
    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId },
      include: {
        bed: {
          include: { ward: true },
        },
      },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    const bedRate = admission.bed?.dailyRate ?? admission.bed?.ward?.defaultDailyRate ?? 0;
    const days = this.calculateDays(admission.admittedAt, chargeDate);

    const existingCharges = await this.db.prisma.bedCharge.count({
      where: { admissionId, clinicId, clinicLocationId: admission.clinicLocationId, chargeDate },
    });

    if (existingCharges > 0) {
      throw new HealthcareError(
        'Charges already accrued for this date',
        ErrorCode.VALIDATION_ERROR,
        { admissionId, chargeDate }
      );
    }

    return {
      admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId: admission.clinicLocationId,
      chargeDate: chargeDate.toISOString(),
      days,
      bedRate,
      bedCharges: days * bedRate,
      totalCharges: days * bedRate,
      isBilled: false,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Calculates days between admission date and charge date.
   */
  private calculateDays(admittedAt: Date, chargeDate: Date): number {
    const diffMs = chargeDate.getTime() - admittedAt.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays);
  }

  /**
   * Gets total accumulated charges for an admission.
   */
  async getTotalAccruedCharges(admissionId: string, clinicId: string): Promise<number> {
    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId },
      select: { clinicLocationId: true },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    const result = await this.db.prisma.bedCharge.aggregate({
      where: { admissionId, clinicId, clinicLocationId: admission.clinicLocationId },
      _sum: { totalCharges: true },
    });

    return result._sum?.totalCharges ?? 0;
  }
}
