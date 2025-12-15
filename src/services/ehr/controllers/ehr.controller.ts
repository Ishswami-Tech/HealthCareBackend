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
} from '@dtos/ehr.dto';
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  ImmunizationResponse,
} from '@core/types/ehr.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { PatientCache } from '@core/decorators';
import { Role } from '@core/types/enums.types';

@Controller('ehr')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class EHRController {
  constructor(private readonly ehrService: EHRService) {}

  // ============ Comprehensive Health Record ============

  @Get('comprehensive/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:comprehensive:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'health_records', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getComprehensiveHealthRecord(@Param('userId') userId: string): Promise<unknown> {
    return this.ehrService.getComprehensiveHealthRecord(userId);
  }

  // ============ Medical History ============

  @Post('medical-history')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createMedicalHistory(@Body() createDto: CreateMedicalHistoryDto) {
    return this.ehrService.createMedicalHistory(createDto);
  }

  @Get('medical-history/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:medical-history:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'medical_history', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedicalHistory(@Param('userId') userId: string): Promise<MedicalHistoryResponse[]> {
    return await this.ehrService.getMedicalHistory(userId);
  }

  @Put('medical-history/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateMedicalHistory(
    @Param('id') id: string,
    @Body() updateDto: UpdateMedicalHistoryDto
  ): Promise<unknown> {
    return this.ehrService.updateMedicalHistory(id, updateDto);
  }

  @Delete('medical-history/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedicalHistory(@Param('id') id: string): Promise<void> {
    await this.ehrService.deleteMedicalHistory(id);
  }

  // ============ Lab Reports ============

  @Post('lab-reports')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.LAB_TECHNICIAN)
  @RequireResourcePermission('lab-reports', 'create')
  async createLabReport(@Body() createDto: CreateLabReportDto): Promise<unknown> {
    return this.ehrService.createLabReport(createDto);
  }

  @Get('lab-reports/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.LAB_TECHNICIAN)
  @RequireResourcePermission('lab-reports', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:lab-reports:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'lab_reports', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getLabReports(@Param('userId') userId: string): Promise<LabReportResponse[]> {
    return await this.ehrService.getLabReports(userId);
  }

  @Put('lab-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.LAB_TECHNICIAN)
  @RequireResourcePermission('lab-reports', 'update')
  async updateLabReport(@Param('id') id: string, @Body() updateDto: UpdateLabReportDto) {
    return this.ehrService.updateLabReport(id, updateDto);
  }

  @Delete('lab-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN, Role.LAB_TECHNICIAN)
  @RequireResourcePermission('lab-reports', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLabReport(@Param('id') id: string) {
    await this.ehrService.deleteLabReport(id);
  }

  // ============ Radiology Reports ============

  @Post('radiology-reports')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'create')
  async createRadiologyReport(@Body() createDto: CreateRadiologyReportDto) {
    return this.ehrService.createRadiologyReport(createDto);
  }

  @Get('radiology-reports/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:radiology-reports:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'radiology_reports', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getRadiologyReports(@Param('userId') userId: string): Promise<RadiologyReportResponse[]> {
    return await this.ehrService.getRadiologyReports(userId);
  }

  @Put('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'update')
  async updateRadiologyReport(
    @Param('id') id: string,
    @Body() updateDto: UpdateRadiologyReportDto
  ) {
    return this.ehrService.updateRadiologyReport(id, updateDto);
  }

  @Delete('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRadiologyReport(@Param('id') id: string) {
    await this.ehrService.deleteRadiologyReport(id);
  }

  // ============ Surgical Records ============

  @Post('surgical-records')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'create')
  async createSurgicalRecord(@Body() createDto: CreateSurgicalRecordDto) {
    return this.ehrService.createSurgicalRecord(createDto);
  }

  @Get('surgical-records/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:surgical-records:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'surgical_records', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getSurgicalRecords(@Param('userId') userId: string): Promise<SurgicalRecordResponse[]> {
    return await this.ehrService.getSurgicalRecords(userId);
  }

  @Put('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'update')
  async updateSurgicalRecord(@Param('id') id: string, @Body() updateDto: UpdateSurgicalRecordDto) {
    return this.ehrService.updateSurgicalRecord(id, updateDto);
  }

  @Delete('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSurgicalRecord(@Param('id') id: string) {
    await this.ehrService.deleteSurgicalRecord(id);
  }

  // ============ Vitals ============

  @Post('vitals')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'create')
  async createVital(@Body() createDto: CreateVitalDto) {
    return this.ehrService.createVital(createDto);
  }

  @Get('vitals/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:vitals:{userId}:{type}',
    ttl: 900, // 15 minutes (vitals change frequently)
    tags: ['ehr', 'vitals', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getVitals(@Param('userId') userId: string, @Query('type') type?: string): Promise<unknown> {
    return (await this.ehrService.getVitals(userId, type)) as unknown;
  }

  @Put('vitals/:id')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'update')
  async updateVital(@Param('id') id: string, @Body() updateDto: UpdateVitalDto) {
    return this.ehrService.updateVital(id, updateDto);
  }

  @Delete('vitals/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('vitals', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVital(@Param('id') id: string) {
    await this.ehrService.deleteVital(id);
  }

  // ============ Allergies ============

  @Post('allergies')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createAllergy(@Body() createDto: CreateAllergyDto) {
    return this.ehrService.createAllergy(createDto);
  }

  @Get('allergies/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:allergies:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'allergies', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getAllergies(@Param('userId') userId: string): Promise<unknown> {
    return (await this.ehrService.getAllergies(userId)) as unknown;
  }

  @Put('allergies/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateAllergy(@Param('id') id: string, @Body() updateDto: UpdateAllergyDto) {
    return this.ehrService.updateAllergy(id, updateDto);
  }

  @Delete('allergies/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllergy(@Param('id') id: string) {
    await this.ehrService.deleteAllergy(id);
  }

  // ============ Medications ============

  @Post('medications')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'create')
  async createMedication(@Body() createDto: CreateMedicationDto) {
    return this.ehrService.createMedication(createDto);
  }

  @Get('medications/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
    @Query('activeOnly') activeOnly?: string
  ): Promise<unknown> {
    return (await this.ehrService.getMedications(userId, activeOnly === 'true')) as unknown;
  }

  @Put('medications/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'update')
  async updateMedication(@Param('id') id: string, @Body() updateDto: UpdateMedicationDto) {
    return this.ehrService.updateMedication(id, updateDto);
  }

  @Delete('medications/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medications', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedication(@Param('id') id: string) {
    await this.ehrService.deleteMedication(id);
  }

  // ============ Immunizations ============

  @Post('immunizations')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'create')
  async createImmunization(@Body() createDto: CreateImmunizationDto) {
    return this.ehrService.createImmunization(createDto);
  }

  @Get('immunizations/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:immunizations:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['ehr', 'immunizations', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getImmunizations(@Param('userId') userId: string): Promise<ImmunizationResponse[]> {
    return await this.ehrService.getImmunizations(userId);
  }

  @Put('immunizations/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'update')
  async updateImmunization(@Param('id') id: string, @Body() updateDto: UpdateImmunizationDto) {
    return this.ehrService.updateImmunization(id, updateDto);
  }

  @Delete('immunizations/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('medical-records', 'delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImmunization(@Param('id') id: string) {
    await this.ehrService.deleteImmunization(id);
  }

  // ============ Analytics ============

  @Get('analytics/health-trends/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
    @Query('vitalType') vitalType: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    return this.ehrService.getHealthTrends(
      userId,
      vitalType,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
  }

  @Get('analytics/medication-adherence/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('ehr', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'ehr:analytics:medication-adherence:{userId}',
    ttl: 300, // 5 minutes (analytics change frequently)
    tags: ['ehr', 'analytics', 'medication_adherence', 'user:{userId}'],
    containsPHI: true,
    compress: true,
    enableSWR: true,
  })
  async getMedicationAdherence(@Param('userId') userId: string) {
    return this.ehrService.getMedicationAdherence(userId);
  }
}
