/**
 * Ayurveda Controller
 * @module Ayurveda
 * @description REST controller for Ayurvedic clinical data APIs
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  BadRequestException,
} from '@nestjs/common';
import {
  CreatePrakritiAssessmentDto,
  CreateNadiParikshaDto,
  CreateAyurvedicDiagnosisDto,
  CreateSampraptiStageDto,
  CreateDoshaImbalanceDto,
  CreateAyurvedicTreatmentPlanDto,
  UpdatePrakritiAssessmentDto,
} from '@services/ayurveda/dto';
import type {
  PrakritiAssessmentResponseDto,
  NadiParikshaResponseDto,
  AyurvedicDiagnosisResponseDto,
  SampraptiStageResponseDto,
  DoshaImbalanceResponseDto,
  AyurvedicTimelineResponseDto,
  AyurvedicTreatmentPlanDto,
} from '@services/ayurveda/dto';
import { AyurvedaService } from '@services/ayurveda/ayurveda.service';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';

/**
 * Controller for Ayurvedic clinical data operations.
 *
 * Provides endpoints for:
 * - Prakriti (constitution) assessments
 * - Nadi Pariksha (pulse diagnosis)
 * - Ayurvedic diagnosis management
 * - Samprapti (disease pathogenesis) tracking
 * - Dosha imbalance tracking
 * - Longitudinal Ayurvedic timeline
 *
 * @public
 */
@Controller('ayurveda')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class AyurvedaController {
  /**
   * Creates an instance of AyurvedaController.
   * @param ayurvedaService - Main Ayurveda orchestrator service
   */
  constructor(private readonly ayurvedaService: AyurvedaService) {}

  // ============ Prakriti Assessment ============

  /**
   * Creates a new Prakriti (constitution) assessment.
   * POST /ayurveda/prakriti/assessments
   */
  @Post('prakriti/assessments')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async createPrakritiAssessment(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreatePrakritiAssessmentDto
  ): Promise<PrakritiAssessmentResponseDto> {
    return this.ayurvedaService.createPrakritiAssessment(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Lists Prakriti assessment history for a patient.
   * GET /ayurveda/prakriti/assessments?patientId=&limit=&offset=
   */
  @Get('prakriti/assessments')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ayurveda', 'read', { requireOwnership: true })
  async getPrakritiAssessments(
    @Query('patientId') patientId: string,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PrakritiAssessmentResponseDto[]> {
    return this.ayurvedaService.getPrakritiHistory(
      patientId,
      req.clinicContext?.clinicId as string,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10)
    );
  }

  /**
   * Retrieves a specific Prakriti assessment by ID.
   * GET /ayurveda/prakriti/assessments/:id
   */
  @Get('prakriti/assessments/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ayurveda', 'read')
  async getPrakritiAssessment(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<PrakritiAssessmentResponseDto> {
    return this.ayurvedaService.getPrakritiById(id, req.clinicContext?.clinicId as string);
  }

  /**
   * Updates a Prakriti assessment (practitioner notes).
   * PATCH /ayurveda/prakriti/assessments/:id
   */
  @Patch('prakriti/assessments/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async updatePrakritiAssessment(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: UpdatePrakritiAssessmentDto
  ): Promise<PrakritiAssessmentResponseDto> {
    return this.ayurvedaService.updatePrakritiAssessment(
      id,
      dto,
      req.clinicContext?.clinicId as string
    );
  }

  // ============ Nadi Pariksha ============

  /**
   * Creates a new Nadi Pariksha (pulse diagnosis) record.
   * POST /ayurveda/nadi-pariksha
   */
  @Post('nadi-pariksha')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async createNadiPariksha(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateNadiParikshaDto
  ): Promise<NadiParikshaResponseDto> {
    return this.ayurvedaService.createNadiPariksha(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Retrieves Nadi Pariksha history for a patient.
   * GET /ayurveda/nadi-pariksha?patientId=
   */
  @Get('nadi-pariksha')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ayurveda', 'read', { requireOwnership: true })
  async getNadiParikshaHistory(
    @Query('patientId') patientId: string,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<NadiParikshaResponseDto[]> {
    return this.ayurvedaService.getNadiHistory(
      patientId,
      req.clinicContext?.clinicId as string,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10)
    );
  }

  // ============ Ayurvedic Diagnosis ============

  /**
   * Creates a new Ayurvedic diagnosis.
   * POST /ayurveda/diagnoses
   */
  @Post('diagnoses')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async createDiagnosis(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateAyurvedicDiagnosisDto
  ): Promise<AyurvedicDiagnosisResponseDto> {
    return this.ayurvedaService.createDiagnosis(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Retrieves a specific Ayurvedic diagnosis by ID.
   * GET /ayurveda/diagnoses/:id
   */
  @Get('diagnoses/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'read')
  async getDiagnosis(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AyurvedicDiagnosisResponseDto> {
    return this.ayurvedaService.getDiagnosisById(id, req.clinicContext?.clinicId as string);
  }

  // ============ Samprapti (Disease Pathogenesis) ============

  /**
   * Records a new Samprapti (disease pathogenesis) stage.
   * POST /ayurveda/samprapti/:diagnosisId/stage
   */
  @Post('samprapti/:diagnosisId/stage')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async recordSampraptiStage(
    @Param('diagnosisId') diagnosisId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateSampraptiStageDto
  ): Promise<SampraptiStageResponseDto> {
    return this.ayurvedaService.recordSampraptiStage(
      diagnosisId,
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Retrieves Samprapti stages for a diagnosis.
   * GET /ayurveda/samprapti/:diagnosisId/stages
   */
  @Get('samprapti/:diagnosisId/stages')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'read')
  async getSampraptiStages(
    @Param('diagnosisId') diagnosisId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SampraptiStageResponseDto[]> {
    return this.ayurvedaService.getSampraptiStages(
      diagnosisId,
      req.clinicContext?.clinicId as string
    );
  }

  // ============ Dosha Imbalance ============

  /**
   * Records a new dosha imbalance assessment.
   * POST /ayurveda/dosha-imbalance
   */
  @Post('dosha-imbalance')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async recordDoshaImbalance(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateDoshaImbalanceDto
  ): Promise<DoshaImbalanceResponseDto> {
    return this.ayurvedaService.recordDoshaImbalance(
      dto,
      req.user?.id as string,
      req.clinicContext?.clinicId as string
    );
  }

  /**
   * Retrieves current dosha imbalances for a patient.
   * GET /ayurveda/dosha-imbalance?patientId=
   */
  @Get('dosha-imbalance')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ayurveda', 'read', { requireOwnership: true })
  async getDoshaImbalances(
    @Query('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DoshaImbalanceResponseDto[]> {
    return this.ayurvedaService.getDoshaImbalances(
      patientId,
      req.clinicContext?.clinicId as string
    );
  }

  // ============ Timeline ============

  /**
   * Retrieves longitudinal Ayurvedic timeline for a patient.
   * GET /ayurveda/patients/:patientId/timeline
   *
   * Aggregates all Ayurvedic assessment data chronologically
   * with dosha trend analysis.
   */
  @Get('patients/:patientId/timeline')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ayurveda', 'read', { requireOwnership: true })
  async getAyurvedicTimeline(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string
  ): Promise<AyurvedicTimelineResponseDto> {
    if (fromDate && toDate && new Date(fromDate) > new Date(toDate)) {
      throw new BadRequestException('fromDate must be before toDate');
    }

    return this.ayurvedaService.getPatientTimeline(
      patientId,
      req.clinicContext?.clinicId as string,
      fromDate,
      toDate
    );
  }

  /**
   * Previews a normalized Ayurvedic treatment plan.
   * POST /ayurveda/treatment-plans/preview
   */
  @Post('treatment-plans/preview')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ayurveda', 'write')
  async previewTreatmentPlan(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: CreateAyurvedicTreatmentPlanDto
  ): Promise<AyurvedicTreatmentPlanDto> {
    return this.ayurvedaService.previewTreatmentPlan({
      ...dto,
      clinicId: req.clinicContext?.clinicId as string,
    });
  }
}
