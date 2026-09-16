/**
 * IPD Billing Service
 * @module IPD Billing Service
 * @description Thin orchestrator for daily bed charge accruals and IPD billing
 */

import { Injectable } from '@nestjs/common';
import type { AccrueDailyChargesDto, BedChargeResponseDto } from '@services/ipd/dto';
import { IpdBillingCalculationService } from './ipd-billing-calculation.service';

/**
 * Service for IPD billing operations.
 *
 * Provides:
 * - Daily bed charge accrual per admission
 * - Total accumulated IPD charges per admission
 * - Integration with billing system via event emission
 *
 * @public
 */
@Injectable()
export class IpdBillingService {
  constructor(private readonly calc: IpdBillingCalculationService) {}

  /**
   * Accrues daily bed charges for an admission.
   */
  async accrueDailyCharges(
    dto: AccrueDailyChargesDto,
    userId: string,
    clinicId: string
  ): Promise<BedChargeResponseDto> {
    const chargeDate = dto.chargeDate ? new Date(dto.chargeDate) : new Date();
    const calculated = await this.calc.calculateDailyCharges(
      dto.admissionId,
      clinicId,
      chargeDate,
      userId
    );

    const additionalTotal = (dto.additionalCharges ?? []).reduce(
      (sum: number, charge: { amount: number }) => sum + (charge.amount || 0),
      0
    );

    return {
      id: 'PENDING',
      admissionId: calculated.admissionId,
      patientId: calculated.patientId,
      clinicId: calculated.clinicId,
      clinicLocationId: calculated.clinicLocationId,
      chargeDate: calculated.chargeDate,
      days: calculated.days,
      bedRate: calculated.bedRate,
      bedCharges: calculated.bedCharges,
      additionalCharges: dto.additionalCharges,
      totalCharges: calculated.totalCharges + additionalTotal,
      isBilled: calculated.isBilled,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Gets total accumulated IPD charges for an admission.
   */
  async getTotalCharges(
    admissionId: string,
    clinicId: string
  ): Promise<{ total: number; pending: number }> {
    const total = await this.calc.getTotalAccruedCharges(admissionId, clinicId);
    return { total, pending: total };
  }
}
