/**
 * Discharge Summary Service
 * @module Discharge Summary Service
 * @description Assembles and generates discharge summary data suitable for PDF rendering
 */

import { Injectable } from '@nestjs/common';
import type {
  AdmissionResponseDto,
  DischargeSummaryResponseDto,
  NursingNoteResponseDto,
  VitalsResponseDto,
  BedsideMedicationResponseDto,
} from '@services/ipd/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';
import {
  assembleDischargeSummary,
  summarizeNursingNotes,
  summarizeVitals,
} from './discharge-summary.assembly';

const DISCHARGE_CACHE_PREFIX = 'ipd:discharge';

type AdmissionRecord = {
  id: string;
  admissionNumber: string;
  patientId: string;
  clinicId: string;
  clinicLocationId: string;
  wardId: string;
  bedId: string;
  admittingDoctorId: string;
  status: string;
  admittedAt: Date;
  primaryDiagnosis?: string | null;
  secondaryDiagnoses?: unknown;
  admissionReason: string;
  expectedDischargeDate?: Date | null;
  referringDoctor?: string | null;
  attendantName?: string | null;
  attendantPhone?: string | null;
  insuranceDetails?: unknown;
  notes?: string | null;
  dischargedAt?: Date | null;
  dischargeType?: string | null;
  dischargedById?: string | null;
  finalDiagnosis?: string | null;
  treatmentSummary?: string | null;
  followUpInstructions?: string | null;
  followUpDate?: Date | null;
  dischargeMedications?: unknown;
  dischargeAdvice?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DischargeSummaryRecord = {
  id: string;
  admissionId: string;
  patientId: string;
  clinicId: string;
  clinicLocationId: string;
  finalDiagnosis?: string | null;
  treatmentSummary?: string | null;
  dischargeType: string;
  dischargedAt: Date;
  dischargedById?: string | null;
  followUpInstructions?: string | null;
  followUpDate?: Date | null;
  dischargeMedications?: unknown;
  dischargeAdvice?: string | null;
  notes?: string | null;
  nursingNotesCount: number;
  vitalsEntriesCount: number;
  medicationsAdministered: number;
  pdfGenerated: boolean;
  pdfUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DischargeSummaryOverlay = {
  finalDiagnosis?: string | undefined;
  treatmentSummary?: string | undefined;
};

@Injectable()
export class DischargeSummaryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  async generateDischargeSummary(
    admissionId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<DischargeSummaryResponseDto> {
    this.logger.info('Generating discharge summary', {
      module: 'DischargeSummary',
      admissionId,
      clinicId,
      clinicLocationId,
    });

    const admission = await this.db.prisma.admission.findFirst({
      where: { id: admissionId, clinicId, clinicLocationId },
    });

    if (!admission) {
      throw new HealthcareError('Admission not found', ErrorCode.RESOURCE_NOT_FOUND, {
        admissionId,
      });
    }

    if (admission.status === 'ADMITTED' || admission.status === 'TRANSFERRED') {
      throw this.errorsService.ipdAlreadyDischarged(
        'DischargeSummaryService.generateDischargeSummary'
      );
    }

    const admissionDto = this.mapAdmissionToDto(admission as AdmissionRecord);

    const [nursingNotes, vitals, medications] = await Promise.all([
      this.db.prisma.nursingNote.findMany({
        where: { admissionId, clinicId, clinicLocationId },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.prisma.vitalsFlowsheet.findMany({
        where: { admissionId, clinicId, clinicLocationId },
        orderBy: { recordedAt: 'asc' },
      }),
      this.db.prisma.bedsideMedication.findMany({
        where: { admissionId, clinicId, clinicLocationId },
        orderBy: { administeredAt: 'desc' },
      }),
    ]);

    const summaryData = assembleDischargeSummary(
      admissionDto,
      nursingNotes as unknown as NursingNoteResponseDto[],
      vitals as unknown as VitalsResponseDto[],
      medications as unknown as BedsideMedicationResponseDto[]
    );

    const summary = await this.db.prisma.dischargeSummary.create({
      data: {
        admissionId,
        patientId: admission.patientId,
        clinicId,
        clinicLocationId,
        finalDiagnosis: admission.finalDiagnosis ?? null,
        treatmentSummary: admission.treatmentSummary ?? null,
        dischargeType: admission.dischargeType ?? 'REGULAR',
        dischargedAt: admission.dischargedAt ?? new Date(),
        dischargedById: admission.dischargedById,
        followUpInstructions: admission.followUpInstructions,
        followUpDate: admission.followUpDate,
        dischargeMedications: admission.dischargeMedications as never,
        dischargeAdvice: admission.dischargeAdvice,
        notes: admission.notes,
        nursingNotesCount: nursingNotes.length,
        vitalsEntriesCount: vitals.length,
        medicationsAdministered: medications.length,
      },
    });

    await this.events.emit('ipd.dischargeSummary.generated', {
      summaryId: summary.id,
      admissionId,
      patientId: admission.patientId,
      clinicId,
      clinicLocationId,
      pdfGenerated: summary.pdfGenerated,
    });

    this.logger.info('Discharge summary generated', {
      module: 'DischargeSummary',
      summaryId: summary.id,
      admissionId,
    });

    return this.mapSummaryToDto(summary as DischargeSummaryRecord, summaryData);
  }

  async getDischargeSummary(
    admissionId: string,
    clinicId: string,
    clinicLocationId: string
  ): Promise<DischargeSummaryResponseDto> {
    const cacheKey = `${DISCHARGE_CACHE_PREFIX}:${clinicId}:${clinicLocationId}:${admissionId}`;

    const cached = await this.cache.get<DischargeSummaryResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const summary = await this.db.prisma.dischargeSummary.findFirst({
      where: { admissionId, clinicId, clinicLocationId },
    });

    if (!summary) {
      return this.generateDischargeSummary(admissionId, clinicId, clinicLocationId);
    }

    const result = this.mapSummaryToDto(summary as DischargeSummaryRecord, {});
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  async getAllDischargeSummaries(
    clinicId: string,
    clinicLocationId: string,
    page = 1,
    limit = 20
  ): Promise<{ data: DischargeSummaryResponseDto[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;

    const [summaries, total] = await Promise.all([
      this.db.prisma.dischargeSummary.findMany({
        where: { clinicId, clinicLocationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.db.prisma.dischargeSummary.count({ where: { clinicId, clinicLocationId } }),
    ]);

    const data = summaries.map(summary =>
      this.mapSummaryToDto(summary as DischargeSummaryRecord, {
        finalDiagnosis: summary.finalDiagnosis ?? undefined,
        treatmentSummary: summary.treatmentSummary ?? undefined,
      })
    );

    return { data, total, page, limit };
  }

  private mapSummaryToDto(
    summary: DischargeSummaryRecord,
    data: DischargeSummaryOverlay
  ): DischargeSummaryResponseDto {
    return {
      id: summary.id,
      admissionId: summary.admissionId,
      patientId: summary.patientId,
      clinicId: summary.clinicId,
      clinicLocationId: summary.clinicLocationId,
      finalDiagnosis: data.finalDiagnosis ?? summary.finalDiagnosis ?? undefined,
      treatmentSummary: data.treatmentSummary ?? summary.treatmentSummary ?? undefined,
      dischargeType: summary.dischargeType,
      dischargedAt: summary.dischargedAt.toISOString(),
      dischargedById: summary.dischargedById ?? undefined,
      dischargedByName: undefined,
      followUpInstructions: summary.followUpInstructions ?? undefined,
      followUpDate: summary.followUpDate?.toISOString(),
      dischargeMedications: Array.isArray(summary.dischargeMedications)
        ? (summary.dischargeMedications as Array<{
            medicationName: string;
            dosage: string;
            frequency: string;
            duration: string;
          }>)
        : undefined,
      dischargeAdvice: summary.dischargeAdvice ?? undefined,
      pdfGenerated: summary.pdfGenerated,
      pdfUrl: summary.pdfUrl ?? undefined,
      notes: summary.notes ?? undefined,
      createdAt: summary.createdAt.toISOString(),
    };
  }

  private mapAdmissionToDto(admission: AdmissionRecord): AdmissionResponseDto {
    return {
      id: admission.id,
      admissionNumber: admission.admissionNumber,
      patientId: admission.patientId,
      clinicId: admission.clinicId,
      clinicLocationId: admission.clinicLocationId,
      wardId: admission.wardId,
      bedId: admission.bedId,
      admittingDoctorId: admission.admittingDoctorId,
      status: admission.status,
      admittedAt: admission.admittedAt.toISOString(),
      primaryDiagnosis: admission.primaryDiagnosis ?? undefined,
      secondaryDiagnoses: Array.isArray(admission.secondaryDiagnoses)
        ? (admission.secondaryDiagnoses as string[])
        : undefined,
      admissionReason: admission.admissionReason,
      expectedDischargeDate: admission.expectedDischargeDate?.toISOString(),
      referringDoctor: admission.referringDoctor ?? undefined,
      attendantName: admission.attendantName ?? undefined,
      attendantPhone: admission.attendantPhone ?? undefined,
      insuranceDetails:
        (admission.insuranceDetails as
          Record<string, unknown> | Array<Record<string, unknown>> | null) ?? null,
      notes: admission.notes ?? undefined,
      dischargedAt: admission.dischargedAt?.toISOString(),
      dischargeType: admission.dischargeType ?? undefined,
      dischargedById: admission.dischargedById ?? undefined,
      finalDiagnosis: admission.finalDiagnosis ?? undefined,
      treatmentSummary: admission.treatmentSummary ?? undefined,
      followUpInstructions: admission.followUpInstructions ?? undefined,
      followUpDate: admission.followUpDate?.toISOString(),
      dischargeMedications: Array.isArray(admission.dischargeMedications)
        ? (admission.dischargeMedications as AdmissionResponseDto['dischargeMedications'])
        : undefined,
      dischargeAdvice: admission.dischargeAdvice ?? undefined,
      createdBy: admission.createdBy ?? undefined,
      createdAt: admission.createdAt.toISOString(),
      updatedAt: admission.updatedAt.toISOString(),
    };
  }
}
