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
} from '@services/ehr/dto/ehr.dto';
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  ImmunizationResponse,
} from '@core/types/ehr.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { PatientCache } from '@core/decorators';
import { Role } from '@core/types/enums.types';

@Controller('ehr')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EHRController {
  constructor(private readonly ehrService: EHRService) {}

  // ============ Comprehensive Health Record ============

  @Get('comprehensive/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  async createMedicalHistory(@Body() createDto: CreateMedicalHistoryDto) {
    return this.ehrService.createMedicalHistory(createDto);
  }

  @Get('medical-history/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  async updateMedicalHistory(
    @Param('id') id: string,
    @Body() updateDto: UpdateMedicalHistoryDto
  ): Promise<unknown> {
    return this.ehrService.updateMedicalHistory(id, updateDto);
  }

  @Delete('medical-history/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedicalHistory(@Param('id') id: string): Promise<void> {
    await this.ehrService.deleteMedicalHistory(id);
  }

  // ============ Lab Reports ============

  @Post('lab-reports')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createLabReport(@Body() createDto: CreateLabReportDto): Promise<unknown> {
    return this.ehrService.createLabReport(createDto);
  }

  @Get('lab-reports/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateLabReport(@Param('id') id: string, @Body() updateDto: UpdateLabReportDto) {
    return this.ehrService.updateLabReport(id, updateDto);
  }

  @Delete('lab-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLabReport(@Param('id') id: string) {
    await this.ehrService.deleteLabReport(id);
  }

  // ============ Radiology Reports ============

  @Post('radiology-reports')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createRadiologyReport(@Body() createDto: CreateRadiologyReportDto) {
    return this.ehrService.createRadiologyReport(createDto);
  }

  @Get('radiology-reports/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getRadiologyReports(@Param('userId') userId: string): Promise<RadiologyReportResponse[]> {
    return await this.ehrService.getRadiologyReports(userId);
  }

  @Put('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateRadiologyReport(
    @Param('id') id: string,
    @Body() updateDto: UpdateRadiologyReportDto
  ) {
    return this.ehrService.updateRadiologyReport(id, updateDto);
  }

  @Delete('radiology-reports/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRadiologyReport(@Param('id') id: string) {
    await this.ehrService.deleteRadiologyReport(id);
  }

  // ============ Surgical Records ============

  @Post('surgical-records')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createSurgicalRecord(@Body() createDto: CreateSurgicalRecordDto) {
    return this.ehrService.createSurgicalRecord(createDto);
  }

  @Get('surgical-records/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getSurgicalRecords(@Param('userId') userId: string): Promise<SurgicalRecordResponse[]> {
    return await this.ehrService.getSurgicalRecords(userId);
  }

  @Put('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateSurgicalRecord(@Param('id') id: string, @Body() updateDto: UpdateSurgicalRecordDto) {
    return this.ehrService.updateSurgicalRecord(id, updateDto);
  }

  @Delete('surgical-records/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSurgicalRecord(@Param('id') id: string) {
    await this.ehrService.deleteSurgicalRecord(id);
  }

  // ============ Vitals ============

  @Post('vitals')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createVital(@Body() createDto: CreateVitalDto) {
    return this.ehrService.createVital(createDto);
  }

  @Get('vitals/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getVitals(@Param('userId') userId: string, @Query('type') type?: string): Promise<unknown> {
    return (await this.ehrService.getVitals(userId, type)) as unknown;
  }

  @Put('vitals/:id')
  @Roles(Role.DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateVital(@Param('id') id: string, @Body() updateDto: UpdateVitalDto) {
    return this.ehrService.updateVital(id, updateDto);
  }

  @Delete('vitals/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVital(@Param('id') id: string) {
    await this.ehrService.deleteVital(id);
  }

  // ============ Allergies ============

  @Post('allergies')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createAllergy(@Body() createDto: CreateAllergyDto) {
    return this.ehrService.createAllergy(createDto);
  }

  @Get('allergies/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getAllergies(@Param('userId') userId: string): Promise<unknown> {
    return (await this.ehrService.getAllergies(userId)) as unknown;
  }

  @Put('allergies/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateAllergy(@Param('id') id: string, @Body() updateDto: UpdateAllergyDto) {
    return this.ehrService.updateAllergy(id, updateDto);
  }

  @Delete('allergies/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAllergy(@Param('id') id: string) {
    await this.ehrService.deleteAllergy(id);
  }

  // ============ Medications ============

  @Post('medications')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createMedication(@Body() createDto: CreateMedicationDto) {
    return this.ehrService.createMedication(createDto);
  }

  @Get('medications/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getMedications(
    @Param('userId') userId: string,
    @Query('activeOnly') activeOnly?: string
  ): Promise<unknown> {
    return (await this.ehrService.getMedications(userId, activeOnly === 'true')) as unknown;
  }

  @Put('medications/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateMedication(@Param('id') id: string, @Body() updateDto: UpdateMedicationDto) {
    return this.ehrService.updateMedication(id, updateDto);
  }

  @Delete('medications/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMedication(@Param('id') id: string) {
    await this.ehrService.deleteMedication(id);
  }

  // ============ Immunizations ============

  @Post('immunizations')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async createImmunization(@Body() createDto: CreateImmunizationDto) {
    return this.ehrService.createImmunization(createDto);
  }

  @Get('immunizations/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async getImmunizations(@Param('userId') userId: string): Promise<ImmunizationResponse[]> {
    return await this.ehrService.getImmunizations(userId);
  }

  @Put('immunizations/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  async updateImmunization(@Param('id') id: string, @Body() updateDto: UpdateImmunizationDto) {
    return this.ehrService.updateImmunization(id, updateDto);
  }

  @Delete('immunizations/:id')
  @Roles(Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteImmunization(@Param('id') id: string) {
    await this.ehrService.deleteImmunization(id);
  }

  // ============ Analytics ============

  @Get('analytics/health-trends/:userId')
  @Roles(Role.DOCTOR, Role.PATIENT, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
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
  async getMedicationAdherence(@Param('userId') userId: string) {
    return this.ehrService.getMedicationAdherence(userId);
  }
}
