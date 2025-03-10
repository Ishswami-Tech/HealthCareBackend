import { Controller, Get, Post, Body, Param, Delete, UseGuards, Request } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { JwtAuthGuard } from '../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../libs/guards/roles.guard';
import { Roles } from '../../libs/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { AssignClinicAdminDto } from './dto/assign-clinic-admin.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';

@ApiTags('clinics')
@Controller('clinics')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new clinic' })
  @ApiResponse({ status: 201, description: 'The clinic has been successfully created.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 409, description: 'Clinic with this name already exists.' })
  async createClinic(
    @Body() createClinicDto: CreateClinicDto,
    @Request() req,
  ) {
    return this.clinicService.createClinic({
      ...createClinicDto,
      createdBy: req.user.id,
    });
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all clinics' })
  @ApiResponse({ status: 200, description: 'Return all clinics.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getAllClinics(@Request() req) {
    return this.clinicService.getAllClinics(req.user.id);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get a clinic by ID' })
  @ApiResponse({ status: 200, description: 'Return the clinic.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async getClinicById(@Param('id') id: string, @Request() req) {
    return this.clinicService.getClinicById(id, req.user.id);
  }

  @Get('app/:appName')
  @ApiOperation({ summary: 'Get a clinic by app name' })
  @ApiResponse({ status: 200, description: 'Return the clinic.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async getClinicByAppName(@Param('appName') appName: string) {
    return this.clinicService.getClinicByAppName(appName);
  }

  @Post(':id/admins')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign a clinic admin' })
  @ApiResponse({ status: 201, description: 'The clinic admin has been successfully assigned.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Clinic or user not found.' })
  @ApiResponse({ status: 409, description: 'User is already an admin for this clinic.' })
  async assignClinicAdmin(
    @Param('id') clinicId: string,
    @Body() assignClinicAdminDto: AssignClinicAdminDto,
    @Request() req,
  ) {
    return this.clinicService.assignClinicAdmin({
      clinicId,
      userId: assignClinicAdminDto.userId,
      assignedBy: req.user.id,
    });
  }

  @Delete('admins/:id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Remove a clinic admin' })
  @ApiResponse({ status: 200, description: 'The clinic admin has been successfully removed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Clinic admin not found.' })
  async removeClinicAdmin(@Param('id') clinicAdminId: string, @Request() req) {
    return this.clinicService.removeClinicAdmin({
      clinicAdminId,
      removedBy: req.user.id,
    });
  }

  @Get(':id/doctors')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get all doctors for a clinic' })
  @ApiResponse({ status: 200, description: 'Return all doctors for the clinic.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async getClinicDoctors(@Param('id') clinicId: string, @Request() req) {
    return this.clinicService.getClinicDoctors(clinicId, req.user.id);
  }

  @Get(':id/patients')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @ApiOperation({ summary: 'Get all patients for a clinic' })
  @ApiResponse({ status: 200, description: 'Return all patients for the clinic.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async getClinicPatients(@Param('id') clinicId: string, @Request() req) {
    return this.clinicService.getClinicPatients(clinicId, req.user.id);
  }

  @Post('register-patient')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Register a patient to a clinic' })
  @ApiResponse({ status: 201, description: 'The patient has been successfully registered to the clinic.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async registerPatientToClinic(
    @Body() registerPatientDto: RegisterPatientDto,
    @Request() req,
  ) {
    return this.clinicService.registerPatientToClinic({
      userId: req.user.id,
      appName: registerPatientDto.appName,
    });
  }
} 