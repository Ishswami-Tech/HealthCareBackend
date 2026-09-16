/**
 * Admission Controller
 * @module IPD Admission Controller
 * @description REST controller for IPD admission, transfer, discharge
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import type {
  AdmitPatientDto,
  TransferBedDto,
  DischargePatientDto,
  AdmissionResponseDto,
  DischargeSummaryResponseDto,
} from '@services/ipd/dto';
import { AdmissionService } from '@services/ipd/services/admission.service';
import { DischargeSummaryService } from '@services/ipd/services/discharge-summary.service';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';

/**
 * Controller for IPD admission, transfer, discharge, and discharge summary.
 *
 * @public
 */
@Controller('ipd/admissions')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class AdmissionController {
  constructor(
    private readonly admissionService: AdmissionService,
    private readonly dischargeSummaryService: DischargeSummaryService
  ) {}

  /**
   * Retrieves all active admissions.
   * GET /ipd/admissions
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getAllAdmissions(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AdmissionResponseDto[]> {
    return this.admissionService.getActiveAdmissions(
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Admits a patient to IPD.
   * POST /ipd/admissions
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async admitPatient(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: AdmitPatientDto
  ): Promise<AdmissionResponseDto> {
    return this.admissionService.admitPatient(
      dto,
      (req.user.id ?? req.user.sub) as string,
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Retrieves an admission by ID.
   * GET /ipd/admissions/:id
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getAdmission(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AdmissionResponseDto> {
    return this.admissionService.getAdmissionById(
      id,
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Gets all active admissions for the clinic.
   * GET /ipd/admissions/active
   */
  @Get('active')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getActiveAdmissions(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<AdmissionResponseDto[]> {
    return this.admissionService.getActiveAdmissions(
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Transfers a patient to a different bed/ward.
   * POST /ipd/admissions/:id/transfer-bed
   */
  @Post(':id/transfer-bed')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async transferBed(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: TransferBedDto
  ): Promise<AdmissionResponseDto> {
    return this.admissionService.transferBed(
      id,
      dto,
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Discharges a patient from IPD.
   * POST /ipd/admissions/:id/discharge
   */
  @Post(':id/discharge')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'write')
  async dischargePatient(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Body() dto: DischargePatientDto
  ): Promise<AdmissionResponseDto> {
    return this.admissionService.dischargePatient(
      id,
      dto,
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }

  /**
   * Retrieves discharge summary for an admission.
   * GET /ipd/admissions/:id/discharge-summary
   */
  @Get(':id/discharge-summary')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ipd', 'read')
  async getDischargeSummary(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<DischargeSummaryResponseDto> {
    return this.dischargeSummaryService.getDischargeSummary(
      id,
      req.clinicContext?.clinicId as string,
      req.clinicContext?.locationId as string
    );
  }
}
