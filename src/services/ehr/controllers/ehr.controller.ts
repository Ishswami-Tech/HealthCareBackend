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
  BadRequestException,
  NotFoundException,
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
  CreateFamilyHistoryDto,
  UpdateFamilyHistoryDto,
  CreatePrescriptionDto,
  EHRAISummaryDto,
  CreateMedicalRecordDto,
  UpdateMedicalRecordDto,
  MedicalRecordFilterDto,
  MedicationAdherenceQueryDto,
  MarkMedicationDoseDto,
  normaliseMedicalRecordType,
} from '@dtos/ehr.dto';
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  ImmunizationResponse,
  FamilyHistoryResponse,
  MedicalRecordFilters,
  CreateMedicalRecordInput,
} from '@core/types/ehr.types';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ProfileCompletionGuard } from '@core/guards/profile-completion.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { PatientSelfAccessGuard } from '@core/guards/patient-self-access.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { RequiresProfileCompletion } from '@core/decorators/profile-completion.decorator';

import { PatientCache } from '@core/decorators';
import { Role } from '@core/types/enums.types';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

// `@fastify/multipart` runs with attachFieldsToBody (the file is on `req.body.file`),
// not as `req.files`; this decorator reads it from there.
import {
  FastifyFile,
  type MulterFile,
} from '@services/patient-visits/utils/fastify-file.decorator';

@ApiTags('ehr')
@Controller('ehr')
@UseGuards(
  JwtAuthGuard,
  RolesGuard,
  ClinicGuard,
  RbacGuard,
  // PATIENT callers may only address `:userId` / `:patientId` routes with their own
  // id or the id of an ACTIVE dependent (RbacGuard alone lets any PATIENT through).
  PatientSelfAccessGuard,
  ProfileCompletionGuard
)
@RequiresProfileCompletion()
export class EHRController {
  constructor(private readonly ehrService: EHRService) {}

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
  async getEHRAISummary(
    @Param('patientId') patientId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<EHRAISummaryDto> {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context. PATIENT callers
    // are limited to their own / dependents' ids by PatientSelfAccessGuard.
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getEHRAISummary(patientId, clinicId);
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

  // ============ Family History ============

  @Post('family-history')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createFamilyHistory(
    @Body() createDto: CreateFamilyHistoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyHistoryResponse> {
    // 🔒 TENANT ISOLATION: Inject clinicId into DTO
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.createFamilyHistory({ ...createDto, clinicId });
  }

  // Not cached: small per-patient list that is edited inline during intake.
  @Get('family-history/:userId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  async getFamilyHistory(
    @Param('userId') userId: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyHistoryResponse[]> {
    return this.ehrService.getFamilyHistory(userId, req.clinicContext?.clinicId);
  }

  @Put('family-history/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateFamilyHistory(
    @Param('id') id: string,
    @Body() updateDto: UpdateFamilyHistoryDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<FamilyHistoryResponse> {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    return this.ehrService.updateFamilyHistory(id, updateDto, clinicId);
  }

  @Delete('family-history/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFamilyHistory(
    @Param('id') id: string,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<void> {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    await this.ehrService.deleteFamilyHistory(id, clinicId);
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
  async updateLabReport(
    @Param('id') id: string,
    @Body() updateDto: UpdateLabReportDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateLabReport(id, updateDto, clinicId);
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
  async deleteLabReport(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteLabReport(id, clinicId);
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
  @RequireResourcePermission('radiology-reports', 'update')
  async updateRadiologyReport(
    @Param('id') id: string,
    @Body() updateDto: UpdateRadiologyReportDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateRadiologyReport(id, updateDto, clinicId);
  }

  @Delete('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('radiology-reports', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRadiologyReport(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteRadiologyReport(id, clinicId);
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
  @RequireResourcePermission('surgical-records', 'update')
  async updateSurgicalRecord(
    @Param('id') id: string,
    @Body() updateDto: UpdateSurgicalRecordDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateSurgicalRecord(id, updateDto, clinicId);
  }

  @Delete('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('surgical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSurgicalRecord(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteSurgicalRecord(id, clinicId);
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
  async updateVital(
    @Param('id') id: string,
    @Body() updateDto: UpdateVitalDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateVital(id, updateDto, clinicId);
  }

  @Delete('vitals/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVital(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteVital(id, clinicId);
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
  async updateAllergy(
    @Param('id') id: string,
    @Body() updateDto: UpdateAllergyDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateAllergy(id, updateDto, clinicId);
  }

  @Delete('allergies/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllergy(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteAllergy(id, clinicId);
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
  async updateMedication(
    @Param('id') id: string,
    @Body() updateDto: UpdateMedicationDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateMedication(id, updateDto, clinicId);
  }

  @Delete('medications/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedication(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteMedication(id, clinicId);
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
  async updateImmunization(
    @Param('id') id: string,
    @Body() updateDto: UpdateImmunizationDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateImmunization(id, updateDto, clinicId);
  }

  @Delete('immunizations/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImmunization(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    await this.ehrService.deleteImmunization(id, clinicId);
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
    keyTemplate: 'ehr:analytics:medication-adherence:{userId}:{startDate}:{endDate}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['ehr', 'analytics', 'medication_adherence', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedicationAdherence(
    @Param('userId') userId: string,
    @Query() query: MedicationAdherenceQueryDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    // 🔒 TENANT ISOLATION: Use validated clinicId from guard context
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.getMedicationAdherence(userId, clinicId, query);
  }

  /**
   * PATIENT marks one dose of their own medication as taken (`taken: false` undoes it).
   * Idempotent per (medication, day, dose). 403 for another patient's medication.
   */
  @Post('medications/:id/doses')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT)
  @RequireResourcePermission('medications', 'log')
  async markMedicationDose(
    @Param('id') id: string,
    @Body() dto: MarkMedicationDoseDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const userId = req.user?.id ?? req.user?.sub;
    if (!userId) throw new ForbiddenException('User not found in token');
    return this.ehrService.markMedicationDose(
      id,
      dto,
      { userId, role: req.user?.role },
      req.clinicContext?.clinicId
    );
  }

  // ============ Medical Records ============

  // PATIENT: own chart only, type LAB_TEST / GENERAL_DOCUMENT (aliases LAB_REPORT / OTHER),
  // doctor attribution resolved server-side (see EHRService.createMedicalRecord).
  @Post('medical-records')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN,
    Role.PATIENT
  )
  @RequireResourcePermission('medical-records', 'create')
  async createMedicalRecord(
    @Body() createDto: CreateMedicalRecordDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    if (!clinicId) throw new ForbiddenException('Clinic context required for EHR writes');
    const isPatient = req.user?.role === Role.PATIENT;
    const uploaderId = req.user?.id ?? (isPatient ? undefined : createDto.uploadedBy);
    if (!uploaderId) throw new BadRequestException('uploadedBy is required');
    const recordData: CreateMedicalRecordInput = {
      userId: createDto.userId,
      clinicId,
      type: normaliseMedicalRecordType(createDto.type),
      title: createDto.title,
      uploadedBy: uploaderId,
    };
    // A patient never names the attributed doctor.
    if (createDto.doctorId && !isPatient) recordData.doctorId = createDto.doctorId;
    if (createDto.content) recordData.content = createDto.content;
    if (createDto.notes) recordData.notes = createDto.notes;
    return this.ehrService.createMedicalRecord(
      recordData,
      isPatient ? { userId: uploaderId, role: req.user?.role } : undefined
    );
  }

  @Get('medical-records/patient/:patientId')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  async getMedicalRecords(
    @Param('patientId') patientId: string,
    @Query() query: MedicalRecordFilterDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    const filters: MedicalRecordFilters = {};
    if (query.type) filters.type = query.type;
    if (query.startDate) filters.startDate = new Date(query.startDate);
    if (query.endDate) filters.endDate = new Date(query.endDate);
    if (query.search) filters.search = query.search;
    if (query.doctorId) filters.doctorId = query.doctorId;
    if (query.uploadedBy) filters.uploadedBy = query.uploadedBy;
    return this.ehrService.getMedicalRecords(patientId, clinicId, filters);
  }

  @Get('medical-records/:id')
  @Roles(
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.PATIENT,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @RequireResourcePermission('medical-records', 'read')
  async getMedicalRecordById(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    // The record's owner is only known after loading it, so PATIENT ownership
    // (self or ACTIVE dependent) is enforced inside the service.
    const viewerUserId = req.user?.id ?? req.user?.sub;
    return this.ehrService.getMedicalRecordById(id, clinicId, {
      userId: viewerUserId ?? '',
      role: req.user?.role,
    });
  }

  @Put('medical-records/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateMedicalRecord(
    @Param('id') id: string,
    @Body() updateDto: UpdateMedicalRecordDto,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    const clinicId = req.clinicContext?.clinicId;
    return this.ehrService.updateMedicalRecord(id, updateDto, clinicId);
  }

  @Delete('medical-records/:id')
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  async deleteMedicalRecord(@Param('id') id: string, @Request() req: ClinicAuthenticatedRequest) {
    const clinicId = req.clinicContext?.clinicId;
    const result = await this.ehrService.deleteMedicalRecord(id, clinicId);
    return { success: result };
  }

  /**
   * Multipart field `file`: PDF / JPEG / PNG / WebP / HEIC, at most 10 MB.
   * 400 empty or unsupported file, 413 too large, 404 unknown record (or a record
   * of another clinic), 500 when the file could not be stored. The response
   * `fileUrl` is a presigned URL that expires after 15 minutes.
   */
  @Post('medical-records/:id/upload')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async uploadMedicalRecordFile(
    @Param('id') id: string,
    @FastifyFile() file: MulterFile | null,
    @Request() req: ClinicAuthenticatedRequest
  ) {
    if (!file) {
      throw new BadRequestException('File is required for upload');
    }
    // 🔒 TENANT ISOLATION: only records of the caller's clinic can receive a file
    const clinicId = req.clinicContext?.clinicId;
    const uploaded = await this.ehrService.uploadMedicalRecordFile(
      id,
      file.buffer,
      file.originalname,
      file.mimetype,
      clinicId
    );
    if (!uploaded) {
      throw new NotFoundException(`Medical record with ID ${id} not found`);
    }
    return uploaded;
  }
}
