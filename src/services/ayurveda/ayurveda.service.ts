/**
 * Ayurveda Service
 * @module Ayurveda
 * @description Main orchestrator service for Ayurvedic clinical data operations
 */

import { Injectable } from '@nestjs/common';
import type {
  CreatePrakritiAssessmentDto,
  UpdatePrakritiAssessmentDto,
  CreateNadiParikshaDto,
  CreateAyurvedicDiagnosisDto,
  CreateSampraptiStageDto,
  CreateDoshaImbalanceDto,
  CreateAyurvedicTreatmentPlanDto,
  AyurvedicTreatmentPlanDto,
  PrakritiAssessmentResponseDto,
  NadiParikshaResponseDto,
  AyurvedicDiagnosisResponseDto,
  SampraptiStageResponseDto,
  DoshaImbalanceResponseDto,
  AyurvedicTimelineResponseDto,
  DoshaType,
} from '@services/ayurveda/dto';
import { PrakritiAssessmentService } from '@services/ayurveda/services/prakriti-assessment.service';
import { NadiParikshaService } from '@services/ayurveda/services/nadi-pariksha.service';
import { AyurvedicDiagnosisService } from '@services/ayurveda/services/ayurvedic-diagnosis.service';
import { SampraptiService } from '@services/ayurveda/services/samprapti.service';
import { DoshaImbalanceService } from '@services/ayurveda/services/dosha-imbalance.service';
import { AyurvedicTimelineService } from '@services/ayurveda/services/ayurvedic-timeline.service';
import { HealthcareError, ErrorCode } from '@core/errors';
import { isAyurvedaTreatmentType } from '@core/types/treatment-catalog.types';

const AYURVEDA_CATEGORY = 'AYURVEDA';

/**
 * Main orchestrator service for Ayurvedic clinical data.
 *
 * Delegates to specialized sub-services:
 * - PrakritiAssessmentService: Constitution analysis
 * - NadiParikshaService: Pulse diagnosis
 * - AyurvedicDiagnosisService: Diagnosis management
 * - SampraptiService: Disease pathogenesis tracking
 * - DoshaImbalanceService: Dosha imbalance recording
 * - AyurvedicTimelineService: Longitudinal data aggregation
 *
 * @public
 */
@Injectable()
export class AyurvedaService {
  /**
   * Creates an instance of AyurvedaService.
   * @param prakritiService - Prakriti assessment operations
   * @param nadiService - Nadi Pariksha operations
   * @param diagnosisService - Diagnosis management
   * @param sampraptiService - Disease pathogenesis tracking
   * @param doshaImbalanceService - Dosha imbalance tracking
   * @param timelineService - Longitudinal timeline aggregation
   */
  constructor(
    private readonly prakritiService: PrakritiAssessmentService,
    private readonly nadiService: NadiParikshaService,
    private readonly diagnosisService: AyurvedicDiagnosisService,
    private readonly sampraptiService: SampraptiService,
    private readonly doshaImbalanceService: DoshaImbalanceService,
    private readonly timelineService: AyurvedicTimelineService
  ) {}

  // ============ Prakriti Assessment ============

  /**
   * Creates a new Prakriti (constitution) assessment.
   *
   * @param dto - Assessment data
   * @param userId - ID of the assessing practitioner
   * @param clinicId - Clinic context
   * @returns Created assessment with computed dosha dominance
   */
  async createPrakritiAssessment(
    dto: CreatePrakritiAssessmentDto,
    userId: string,
    clinicId: string
  ): Promise<PrakritiAssessmentResponseDto> {
    return this.prakritiService.createAssessment(dto, userId, clinicId);
  }

  /**
   * Retrieves Prakriti assessment history for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param limit - Maximum results
   * @param offset - Results to skip
   * @returns Array of Prakriti assessments
   */
  async getPrakritiHistory(
    patientId: string,
    clinicId: string,
    limit: number,
    offset: number
  ): Promise<PrakritiAssessmentResponseDto[]> {
    return this.prakritiService.getAssessmentHistory(patientId, clinicId, limit, offset);
  }

  /**
   * Retrieves a specific Prakriti assessment by ID.
   *
   * @param id - Assessment ID
   * @param clinicId - Clinic context
   * @returns Prakriti assessment details
   * @throws {HealthcareError} If assessment not found
   */
  async getPrakritiById(id: string, clinicId: string): Promise<PrakritiAssessmentResponseDto> {
    return this.prakritiService.getAssessmentById(id, clinicId);
  }

  /**
   * Updates a Prakriti assessment with practitioner notes.
   *
   * @param id - Assessment ID
   * @param dto - Update data
   * @param clinicId - Clinic context
   * @returns Updated assessment
   * @throws {HealthcareError} If assessment not found
   */
  async updatePrakritiAssessment(
    id: string,
    dto: UpdatePrakritiAssessmentDto,
    clinicId: string
  ): Promise<PrakritiAssessmentResponseDto> {
    return this.prakritiService.updateAssessment(id, dto, clinicId);
  }

  // ============ Nadi Pariksha ============

  /**
   * Creates a new Nadi Pariksha (pulse diagnosis) record.
   *
   * @param dto - Nadi Pariksha data
   * @param userId - ID of the practitioner
   * @param clinicId - Clinic context
   * @returns Created Nadi Pariksha record
   */
  async createNadiPariksha(
    dto: CreateNadiParikshaDto,
    userId: string,
    clinicId: string
  ): Promise<NadiParikshaResponseDto> {
    return this.nadiService.createNadiPariksha(dto, userId, clinicId);
  }

  /**
   * Retrieves Nadi Pariksha history for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param limit - Maximum results
   * @param offset - Results to skip
   * @returns Array of Nadi Pariksha records
   */
  async getNadiHistory(
    patientId: string,
    clinicId: string,
    limit: number,
    offset: number
  ): Promise<NadiParikshaResponseDto[]> {
    return this.nadiService.getNadiHistory(patientId, clinicId, limit, offset);
  }

  // ============ Ayurvedic Diagnosis ============

  /**
   * Creates a new Ayurvedic diagnosis linking Prakriti, Nadi, and clinical findings.
   *
   * @param dto - Diagnosis data
   * @param userId - ID of the diagnosing practitioner
   * @param clinicId - Clinic context
   * @returns Created diagnosis
   * @throws {HealthcareError} If linked records not found
   */
  async createDiagnosis(
    dto: CreateAyurvedicDiagnosisDto,
    userId: string,
    clinicId: string
  ): Promise<AyurvedicDiagnosisResponseDto> {
    return this.diagnosisService.createDiagnosis(dto, userId, clinicId);
  }

  /**
   * Retrieves an Ayurvedic diagnosis by ID.
   *
   * @param id - Diagnosis ID
   * @param clinicId - Clinic context
   * @returns Diagnosis details
   * @throws {HealthcareError} If diagnosis not found
   */
  async getDiagnosisById(id: string, clinicId: string): Promise<AyurvedicDiagnosisResponseDto> {
    return this.diagnosisService.getDiagnosisById(id, clinicId);
  }

  // ============ Samprapti (Disease Pathogenesis) ============

  /**
   * Records a new Samprapti (disease pathogenesis) stage.
   *
   * @param diagnosisId - Diagnosis ID
   * @param dto - Stage data
   * @param userId - ID of the practitioner
   * @param clinicId - Clinic context
   * @returns Created stage record
   * @throws {HealthcareError} If diagnosis not found
   */
  async recordSampraptiStage(
    diagnosisId: string,
    dto: CreateSampraptiStageDto,
    userId: string,
    clinicId: string
  ): Promise<SampraptiStageResponseDto> {
    return this.sampraptiService.recordStage(
      diagnosisId,
      dto,
      userId,
      clinicId
    ) as unknown as SampraptiStageResponseDto;
  }

  /**
   * Retrieves Samprapti stages for a diagnosis.
   *
   * @param diagnosisId - Diagnosis ID
   * @param clinicId - Clinic context
   * @returns Array of stages sorted by order
   */
  async getSampraptiStages(
    diagnosisId: string,
    clinicId: string
  ): Promise<SampraptiStageResponseDto[]> {
    return this.sampraptiService.getStagesForDiagnosis(
      diagnosisId,
      clinicId
    ) as unknown as SampraptiStageResponseDto[];
  }

  // ============ Dosha Imbalance ============

  /**
   * Records a new dosha imbalance assessment.
   *
   * @param dto - Imbalance data
   * @param userId - ID of the practitioner
   * @param clinicId - Clinic context
   * @returns Created imbalance record
   */
  async recordDoshaImbalance(
    dto: CreateDoshaImbalanceDto,
    userId: string,
    clinicId: string
  ): Promise<DoshaImbalanceResponseDto> {
    return this.doshaImbalanceService.recordImbalance(dto, userId, clinicId);
  }

  /**
   * Retrieves current dosha imbalances for a patient.
   *
   * Returns the latest imbalance record per dosha type.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @returns Array of current imbalance records
   */
  async getDoshaImbalances(
    patientId: string,
    clinicId: string
  ): Promise<DoshaImbalanceResponseDto[]> {
    const imbalances = await this.doshaImbalanceService.getCurrentImbalances(patientId, clinicId);

    return (Object.values(imbalances) as Array<DoshaImbalanceResponseDto | null>).filter(
      (imbalance): imbalance is DoshaImbalanceResponseDto => imbalance !== null
    );
  }

  // ============ Timeline ============

  /**
   * Retrieves longitudinal Ayurvedic timeline for a patient.
   *
   * Aggregates all Ayurvedic assessment data chronologically
   * with dosha trend analysis.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param fromDate - Optional start date filter (ISO string)
   * @param toDate - Optional end date filter (ISO string)
   * @returns Timeline with events, dosha trends, and summary
   */
  async getPatientTimeline(
    patientId: string,
    clinicId: string,
    fromDate?: string,
    toDate?: string
  ): Promise<AyurvedicTimelineResponseDto> {
    return this.timelineService.getPatientTimeline(patientId, clinicId, fromDate, toDate);
  }

  /**
   * Creates a normalized Ayurvedic treatment plan preview.
   *
   * This keeps the plan generic:
   * - treatment identity is separate from requirements
   * - inventory costs are separate from room/resource costs
   * - caller-supplied pricing still wins when provided
   */
  async previewTreatmentPlan(
    dto: CreateAyurvedicTreatmentPlanDto
  ): Promise<AyurvedicTreatmentPlanDto> {
    if (!isAyurvedaTreatmentType(dto.treatmentType)) {
      throw new HealthcareError(
        'Treatment type must be an Ayurveda treatment',
        ErrorCode.VALIDATION_ERROR,
        { treatmentType: dto.treatmentType }
      );
    }

    if (dto.subProcedure && !isAyurvedaTreatmentType(dto.subProcedure)) {
      throw new HealthcareError(
        'Sub-procedure must be an Ayurveda treatment type',
        ErrorCode.VALIDATION_ERROR,
        { subProcedure: dto.subProcedure }
      );
    }

    const requirements = dto.requirements ?? [];
    const baseFee = dto.pricing?.baseFee ?? 0;
    const inventoryFee =
      dto.pricing?.inventoryFee ??
      this.calculateRequirementCost(requirements, ['MEDICINE', 'OIL', 'HERB', 'CONSUMABLE']);
    const resourceFee =
      dto.pricing?.resourceFee ??
      this.calculateRequirementCost(requirements, ['ROOM', 'BED', 'EQUIPMENT', 'NURSING']);
    const additionalFee =
      dto.pricing?.additionalFee ??
      this.calculateRequirementCost(requirements, ['DIET', 'INVESTIGATION', 'PROCEDURE', 'OTHER']);
    const totalFee =
      dto.pricing?.totalFee ??
      Number((baseFee + inventoryFee + resourceFee + additionalFee).toFixed(2));

    const plan: AyurvedicTreatmentPlanDto = {
      diagnosis: dto.diagnosisId
        ? `Ayurvedic treatment plan for diagnosis ${dto.diagnosisId}`
        : `${AYURVEDA_CATEGORY} treatment plan`,
      treatment: dto.subProcedure
        ? `${dto.treatmentType} - ${dto.subProcedure}`
        : dto.treatmentType,
      patientId: dto.patientId,
      clinicId: dto.clinicId,
      category: AYURVEDA_CATEGORY,
      treatmentType: dto.treatmentType,
      roomRequired:
        dto.roomRequired ??
        this.hasRequirementKind(requirements, ['ROOM', 'BED', 'EQUIPMENT', 'NURSING']),
      requirements,
      pricing: {
        currency: dto.pricing?.currency ?? 'INR',
        baseFee,
        inventoryFee,
        resourceFee,
        additionalFee,
        totalFee,
      },
    };

    if (dto.instructions && dto.instructions.length > 0) {
      plan.recommendations = dto.instructions;
    }

    if (dto.diagnosisId) {
      plan.diagnosisId = dto.diagnosisId;
    }

    if (dto.subProcedure) {
      plan.subProcedure = dto.subProcedure;
    }

    return plan;
  }

  private calculateRequirementCost(
    requirements: Array<{ kind?: string; quantity?: number; unitCost?: number }>,
    allowedKinds: string[]
  ): number {
    return Number(
      requirements
        .filter(requirement => allowedKinds.includes(String(requirement.kind || '').toUpperCase()))
        .reduce((sum, requirement) => {
          const quantity = Number(requirement.quantity ?? 1);
          const unitCost = Number(requirement.unitCost ?? 0);
          return sum + quantity * unitCost;
        }, 0)
        .toFixed(2)
    );
  }

  private hasRequirementKind(
    requirements: Array<{ kind?: string }>,
    allowedKinds: string[]
  ): boolean {
    return requirements.some(requirement =>
      allowedKinds.includes(String(requirement.kind || '').toUpperCase())
    );
  }
}
