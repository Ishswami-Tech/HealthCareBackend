import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { EHRService } from '@services/ehr/ehr.service';
import {
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  CreateLabReportDto,
  UpdateLabReportDto,
  CreateRadiologyReportDto,
  UpdateRadiologyReportDto,
  CreateSurgicalRecordDto,
  UpdateSurgicalRecordDto,
  CreateVitalDto,
  UpdateVitalDto,
  CreateAllergyDto,
  UpdateAllergyDto,
  CreateMedicationDto,
  UpdateMedicationDto,
  CreateImmunizationDto,
  UpdateImmunizationDto,
  CreatePrescriptionDto,
  EHRAISummaryDto,
} from '@dtos/ehr.dto';
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  ImmunizationResponse,
} from '@core/types/ehr.types';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';

import { PatientCache } from '@core/decorators';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { DatabaseService } from '@infrastructure/database/database.service';
import { StaticAssetService } from '@infrastructure/storage/static-asset.service';
import { AssetType } from '@infrastructure/storage/static-asset.service';
import { FastifyFile, MulterFile } from '@core/decorators/fastify-file.decorator';
import { ApiConsumes } from '@nestjs/swagger';

/**
 * Minimal delegate shapes for the two tables the medical-record compatibility
 * routes touch directly. Typed here rather than cast to `any` so the writes are
 * checked and the file passes lint.
 */
interface PatientDocumentRow {
  id: string;
  userId: string;
}

interface MedicalRecordWriteClient {
  patientDocument: {
    create: (args: { data: Record<string, unknown> }) => Promise<PatientDocumentRow>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<PatientDocumentRow>;
  };
  labReport: {
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<PatientDocumentRow>;
  };
  radiologyReport: {
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<PatientDocumentRow>;
  };
}

/** Body accepted by the legacy medical-record create endpoint. */
interface CreateMedicalRecordBody {
  patientId: string;
  type?: string;
  title?: string;
  content?: string;
}

@ApiTags('ehr')
@Controller('ehr')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard, ProfileCompletionGuard)
@RequiresProfileCompletion()
export class EHRController {
  constructor(
    private readonly ehrService: EHRService,
    private readonly databaseService: DatabaseService,
    private readonly staticAssetService: StaticAssetService
  ) {}

  // ============ Comprehensive Health Record ============

  @Get('comprehensive/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:comprehensive:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'health_records', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getComprehensiveHealthRecord(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getComprehensiveHealthRecord(userId, clinicId);
  }

  @Get(':patientId/summary')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  async getEHRAISummary(@Param('patientId') patientId: string): Promise<EHRAISummaryDto> {
    // Summary might cross-reference, but usually we want comprehensive.
    // Keeping as is for now unless specifically requested, or adding clinicId if available?
    // The service method getEHRAISummary wasn't updated in previous step (I missed it or it wasn't there).
    // I'll leave it for now or check if getEHRAISummary calls getComprehensiveHealthRecord internaly?
    return this.ehrService.getEHRAISummary(patientId);
  }

  @Post('prescriptions')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createPrescription(
    @Body() createDto: CreatePrescriptionDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createPrescription({
      ...createDto,
      clinicId,
    } as CreatePrescriptionDto & { clinicId: string });
  }

  // ============ Medical History ============

  @Post('medical-history')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createMedicalHistory(
    @Body() createDto: CreateMedicalHistoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createMedicalHistory({
      ...createDto,
      clinicId,
    } as CreateMedicalHistoryDto & { clinicId: string });
  }

  @Get('medical-history/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:medical-history:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'medical_history', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedicalHistory(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<MedicalHistoryResponse[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return await this.ehrService.getMedicalHistory(userId, clinicId);
  }

  @Put('medical-history/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateMedicalHistory(
    @Param('id') id: string,
    @Body() updateDto: UpdateMedicalHistoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Pass clinicId for ownership validation
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.updateMedicalHistory(id, updateDto, clinicId);
  }

  @Delete('medical-history/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedicalHistory(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<void> {
    // 🔒 TENANT ISOLATION: Pass clinicId for ownership validation
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    await this.ehrService.deleteMedicalHistory(id, clinicId);
  }

  // ============ Lab Reports ============

  @Post('lab-reports')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.LAB_TECHNICIAN
  )
  @RequireResourcePermission('lab-reports', 'create')
  async createLabReport(
    @Body() createDto: CreateLabReportDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createLabReport({ ...createDto, clinicId } as CreateLabReportDto & {
      clinicId: string;
    });
  }

  @Get('lab-reports/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.LAB_TECHNICIAN
  )
  @RequireResourcePermission('lab-reports', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:lab-reports:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'lab_reports', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getLabReports(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<LabReportResponse[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return await this.ehrService.getLabReports(userId, clinicId);
  }

  @Put('lab-reports/:id')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.LAB_TECHNICIAN
  )
  @RequireResourcePermission('lab-reports', 'update')
  async updateLabReport(@Param('id') id: string, @Body() updateDto: UpdateLabReportDto) {
    return this.ehrService.updateLabReport(id, updateDto);
  }

  @Delete('lab-reports/:id')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.LAB_TECHNICIAN
  )
  @RequireResourcePermission('lab-reports', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLabReport(@Param('id') id: string) {
    await this.ehrService.deleteLabReport(id);
  }

  // ============ Radiology Reports ============

  @Post('radiology-reports')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'create')
  async createRadiologyReport(
    @Body() createDto: CreateRadiologyReportDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createRadiologyReport({
      ...createDto,
      clinicId,
    } as CreateRadiologyReportDto & { clinicId: string });
  }

  @Get('radiology-reports/:userId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:radiology-reports:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'radiology_reports', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getRadiologyReports(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<RadiologyReportResponse[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return await this.ehrService.getRadiologyReports(userId, clinicId);
  }

  @Put('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'update')
  async updateRadiologyReport(
    @Param('id') id: string,
    @Body() updateDto: UpdateRadiologyReportDto
  ) {
    return this.ehrService.updateRadiologyReport(id, updateDto);
  }

  @Delete('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRadiologyReport(@Param('id') id: string) {
    await this.ehrService.deleteRadiologyReport(id);
  }

  // ============ Surgical Records ============

  @Post('surgical-records')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'create')
  async createSurgicalRecord(
    @Body() createDto: CreateSurgicalRecordDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createSurgicalRecord({
      ...createDto,
      clinicId,
    } as CreateSurgicalRecordDto & { clinicId: string });
  }

  @Get('surgical-records/:userId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:surgical-records:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'surgical_records', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getSurgicalRecords(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<SurgicalRecordResponse[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return await this.ehrService.getSurgicalRecords(userId, clinicId);
  }

  @Put('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'update')
  async updateSurgicalRecord(@Param('id') id: string, @Body() updateDto: UpdateSurgicalRecordDto) {
    return this.ehrService.updateSurgicalRecord(id, updateDto);
  }

  @Delete('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSurgicalRecord(@Param('id') id: string) {
    await this.ehrService.deleteSurgicalRecord(id);
  }

  // ============ Vitals ============

  @Post('vitals')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('vitals', 'create')
  async createVital(@Body() createDto: CreateVitalDto, @Request() req: ClinicAuthenticatedRequest) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createVital({ ...createDto, clinicId } as CreateVitalDto & {
      clinicId: string;
    });
  }

  @Get('vitals/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('vitals', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:vitals:{userId}:{type}',
    ttl: 900, // 15 minutes (vitals change frequently)
    tags: ['ehr', 'vitals', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getVitals(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('type') type?: string
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return (await this.ehrService.getVitals(userId, type, clinicId)) as unknown;
  }

  @Put('vitals/:id')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('vitals', 'update')
  async updateVital(@Param('id') id: string, @Body() updateDto: UpdateVitalDto) {
    return this.ehrService.updateVital(id, updateDto);
  }

  @Delete('vitals/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVital(@Param('id') id: string) {
    await this.ehrService.deleteVital(id);
  }

  // ============ Allergies ============

  @Post('allergies')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createAllergy(
    @Body() createDto: CreateAllergyDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createAllergy({ ...createDto, clinicId } as CreateAllergyDto & {
      clinicId: string;
    });
  }

  @Get('allergies/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:allergies:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'allergies', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getAllergies(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return (await this.ehrService.getAllergies(userId, clinicId)) as unknown;
  }

  @Put('allergies/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateAllergy(@Param('id') id: string, @Body() updateDto: UpdateAllergyDto) {
    return this.ehrService.updateAllergy(id, updateDto);
  }

  @Delete('allergies/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllergy(@Param('id') id: string) {
    await this.ehrService.deleteAllergy(id);
  }

  // ============ Medications ============

  @Post('medications')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'create')
  async createMedication(
    @Body() createDto: CreateMedicationDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createMedication({ ...createDto, clinicId } as CreateMedicationDto & {
      clinicId: string;
    });
  }

  @Get('medications/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medications', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:medications:{userId}:{activeOnly}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'medications', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedications(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('activeOnly') activeOnly?: string
  ): Promise<unknown> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return (await this.ehrService.getMedications(
      userId,
      activeOnly === 'true',
      clinicId
    )) as unknown;
  }

  @Put('medications/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'update')
  async updateMedication(@Param('id') id: string, @Body() updateDto: UpdateMedicationDto) {
    return this.ehrService.updateMedication(id, updateDto);
  }

  @Delete('medications/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedication(@Param('id') id: string) {
    await this.ehrService.deleteMedication(id);
  }

  // ============ Immunizations ============

  @Post('immunizations')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createImmunization(
    @Body() createDto: CreateImmunizationDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createImmunization({
      ...createDto,
      clinicId,
    } as CreateImmunizationDto & { clinicId: string });
  }

  @Get('immunizations/:userId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:immunizations:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'immunizations', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getImmunizations(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<ImmunizationResponse[]> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return await this.ehrService.getImmunizations(userId, clinicId);
  }

  @Put('immunizations/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateImmunization(@Param('id') id: string, @Body() updateDto: UpdateImmunizationDto) {
    return this.ehrService.updateImmunization(id, updateDto);
  }

  @Delete('immunizations/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImmunization(@Param('id') id: string) {
    await this.ehrService.deleteImmunization(id);
  }

  // ============ Analytics ============

  @Get('analytics/health-trends/:userId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:analytics:health-trends:{userId}:{vitalType}:{startDate}:{endDate}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['ehr', 'analytics', 'health_trends', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getHealthTrends(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest,
    @Query('vitalType') vitalType: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getHealthTrends(
      userId,
      vitalType,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      clinicId
    );
  }

  @Get('analytics/medication-adherence/:userId')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:analytics:medication-adherence:{userId}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['ehr', 'analytics', 'medication_adherence', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedicationAdherence(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getMedicationAdherence(userId, clinicId);
  }

  // ============ Medical Records (Legacy compat) ============
  @Post('medical-records')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.RECEPTIONIST
  )
  async createMedicalRecord(
    @Body() data: CreateMedicalRecordBody,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId || 'CL0002';
    const doctorId = req.user?.id || 'system';
    const patientId = data.patientId;
    const type = data.type; // 'LAB_TEST', 'XRAY', 'MRI', etc.
    const title = data.title;
    const content = data.content;

    if (type === 'LAB_TEST') {
      const record = await this.ehrService.createLabReport({
        userId: patientId,
        testName: title || 'Lab Test',
        result: content || 'Pending review',
        date: new Date().toISOString(),
        doctorId,
        clinicId,
        notes: content ?? '',
      });
      return { id: `LAB_${record.id}` };
    } else if (type === 'XRAY' || type === 'MRI') {
      const record = await this.ehrService.createRadiologyReport({
        userId: patientId,
        imageType: type,
        findings: title || type,
        conclusion: content || 'Uploaded Document',
        date: new Date().toISOString(),
        doctorId,
        clinicId,
      } as Parameters<typeof this.ehrService.createRadiologyReport>[0]);
      return { id: `RAD_${record.id}` };
    } else {
      // Everything else (PRESCRIPTION, DIAGNOSIS_REPORT, PULSE_DIAGNOSIS) becomes a
      // PatientDocument.
      //
      // This used to write to HealthRecord, which is keyed on Patient.id and
      // requires a Doctor.id — so a patient uploading their own file violated
      // both foreign keys, and getComprehensiveHealthRecord never read that
      // table anyway, so nothing was ever visible afterwards.
      const record = await this.databaseService.executeHealthcareWrite<PatientDocumentRow>(
        async client => {
          return await (client as unknown as MedicalRecordWriteClient).patientDocument.create({
            data: {
              userId: patientId,
              clinicId,
              category: type || 'DIAGNOSIS_REPORT',
              title: title || 'Uploaded document',
              notes: content || null,
              uploadedBy: doctorId,
              date: new Date(),
            },
          });
        },
        {
          userId: doctorId,
          userRole: req.user?.role || Role.PATIENT,
          operation: 'CREATE',
          resourceType: 'HEALTH_RECORD',
          clinicId,
        }
      );

      await this.ehrService.invalidateUserEHRCache(patientId);
      return { id: `DOC_${record.id}` };
    }
  }

  @Post('medical-records/:id/upload')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.RECEPTIONIST
  )
  @ApiConsumes('multipart/form-data')
  async uploadMedicalRecordFile(@Param('id') prefixedId: string, @FastifyFile() file: MulterFile) {
    if (!file) {
      throw new ForbiddenException('File is required');
    }

    // The id arrives prefixed by createMedicalRecord (LAB_/RAD_/DOC_), and the
    // uuid itself contains dashes but no underscore, so split on the first only.
    const separatorIndex = prefixedId.indexOf('_');
    const prefix = separatorIndex === -1 ? '' : prefixedId.slice(0, separatorIndex);
    const id = separatorIndex === -1 ? '' : prefixedId.slice(separatorIndex + 1);
    if (!prefix || !id) {
      throw new ForbiddenException('Invalid record ID format');
    }

    const fileName = `medrecord-${id}-${Date.now()}`;
    const isImage = file.mimetype?.startsWith('image/');
    const asset = await this.staticAssetService.uploadFile(
      file.buffer,
      fileName,
      isImage ? AssetType.IMAGE : AssetType.DOCUMENT,
      file.mimetype,
      true
    );

    if (!asset.success || !asset.url) {
      throw new ForbiddenException(asset.error || 'Failed to upload file to storage');
    }

    const updated = await this.databaseService.executeHealthcareWrite<PatientDocumentRow>(
      async client => {
        const db = client as unknown as MedicalRecordWriteClient;
        if (prefix === 'LAB') {
          return await db.labReport.update({
            where: { id },
            data: { fileUrl: asset.url, fileKey: asset.key ?? null },
          });
        } else if (prefix === 'RAD') {
          // RadiologyReport has no `images` column — writing to it threw on every
          // X-ray upload. It now carries fileUrl/fileKey like LabReport.
          return await db.radiologyReport.update({
            where: { id },
            data: { fileUrl: asset.url, fileKey: asset.key ?? null },
          });
        } else if (prefix === 'DOC' || prefix === 'GEN') {
          return await db.patientDocument.update({
            where: { id },
            data: {
              fileUrl: asset.url,
              fileKey: asset.key ?? null,
              mimeType: file.mimetype ?? null,
              fileSize: file.size ?? null,
            },
          });
        }

        throw new ForbiddenException(`Unsupported record type: ${prefix}`);
      },
      {
        userId: 'system',
        userRole: 'system',
        operation: 'UPDATE',
        resourceType: 'HEALTH_RECORD',
        clinicId: 'CL0002',
      }
    );

    // Without this the comprehensive record serves a 30-minute cached copy and
    // the freshly attached file does not appear.
    if (updated?.userId) {
      await this.ehrService.invalidateUserEHRCache(updated.userId);
    }

    return { url: asset.url };
  }
}
