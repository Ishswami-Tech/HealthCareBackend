import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { JwtAuthGuard } from '../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../libs/guards/roles.guard';
import { Roles } from '../../libs/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CreateClinicDto } from './dto/create-clinic.dto';
import { AssignClinicAdminDto } from './dto/assign-clinic-admin.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { Request } from 'express';

@ApiTags('Clinics')
@ApiBearerAuth()
@Controller('clinics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClinicController {
  constructor(private readonly clinicService: ClinicService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Create a new clinic',
    description: 'Creates a new clinic with its own isolated database. Both Super Admins and Clinic Admins can create clinics. Super Admins must specify a clinicAdminIdentifier (email or ID), while Clinic Admins automatically become the admin of the clinic they create.' 
  })
  @ApiResponse({ 
    status: 201, 
    description: 'The clinic has been successfully created.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Only Super Admins and Clinic Admins can create clinics.'
  })
  @ApiResponse({ 
    status: 409, 
    description: 'Conflict - A clinic with the same name, email, or subdomain already exists, or the provided clinicAdminIdentifier is not a Clinic Admin.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Specified Clinic Admin not found.'
  })

  // AuthService, the JWT payload contains the user ID in the sub field, not the id field:
  async createClinic(@Body() createClinicDto: CreateClinicDto, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.clinicService.createClinic({
      ...createClinicDto,
      createdBy: userId,
    });
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Get all clinics',
    description: 'Retrieves all clinics based on user permissions. Super Admin can see all clinics, while Clinic Admin can only see their assigned clinics.' 
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns an array of clinics.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to view clinics.'
  })
  async getAllClinics(@Req() req: Request) {
    const userId = req.user['sub'];
    console.log('User ID from request:', userId);
    return this.clinicService.getAllClinics(userId);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Get a clinic by ID',
    description: 'Retrieves a specific clinic by ID based on user permissions. Super Admin can see any clinic, while Clinic Admin can only see their assigned clinics.' 
  })
  @ApiParam({ name: 'id', description: 'The ID of the clinic to retrieve' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the clinic data.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to view this clinic.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async getClinicById(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.clinicService.getClinicById(id, userId);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Update a clinic',
    description: 'Updates a specific clinic by ID. Super Admin can update any clinic, while Clinic Admin can only update their assigned clinics.' 
  })
  @ApiParam({ name: 'id', description: 'The ID of the clinic to update' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the updated clinic data.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to update this clinic.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async updateClinic(
    @Param('id') id: string,
    @Body() updateClinicDto: UpdateClinicDto,
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.clinicService.updateClinic(id, updateClinicDto, userId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Delete a clinic',
    description: 'Deletes a specific clinic by ID and its associated database. Only Super Admin can delete clinics.' 
  })
  @ApiParam({ name: 'id', description: 'The ID of the clinic to delete' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns a success message.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - Only Super Admin can delete clinics.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async deleteClinic(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.clinicService.deleteClinic(id, userId);
  }

  @Post('admin')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Assign a clinic admin',
    description: 'Assigns a user as a clinic admin. Only Super Admin or the clinic owner can assign clinic admins.' 
  })
  @ApiResponse({ 
    status: 201, 
    description: 'The clinic admin has been successfully assigned.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to assign clinic admins.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - User or clinic not found.'
  })
  @ApiResponse({ 
    status: 409, 
    description: 'Conflict - User is already assigned to this clinic or does not have the correct role.'
  })
  async assignClinicAdmin(
    @Body() data: { userId: string; clinicId: string; isOwner?: boolean },
    @Req() req: Request,
  ) {
    const assignedBy = req.user['sub'];
    return this.clinicService.assignClinicAdmin({
      ...data,
      assignedBy,
    });
  }

  @Get('app/:appName')
  @ApiOperation({ 
    summary: 'Get a clinic by app name',
    description: 'Retrieves a specific clinic by app name (subdomain). This endpoint is public and used to determine which clinic database to connect to.' 
  })
  @ApiParam({ name: 'appName', description: 'The app name (subdomain) of the clinic to retrieve' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the clinic data.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async getClinicByAppName(@Param('appName') appName: string) {
    return this.clinicService.getClinicByAppName(appName);
  }

  @Get(':id/doctors')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST)
  @ApiOperation({ 
    summary: 'Get all doctors for a clinic',
    description: 'Retrieves all doctors associated with a specific clinic. Super Admin and Clinic Admin can see all doctors.' 
  })
  @ApiParam({ name: 'id', description: 'The ID of the clinic' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns an array of doctors.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to view doctors from this clinic.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async getClinicDoctors(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.clinicService.getClinicDoctors(id, userId);
  }

  @Get(':id/patients')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR)
  @ApiOperation({ 
    summary: 'Get all patients for a clinic',
    description: 'Retrieves all patients associated with a specific clinic. Super Admin and Clinic Admin can see all patients.' 
  })
  @ApiParam({ name: 'id', description: 'The ID of the clinic' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns an array of patients.'
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Unauthorized - User does not have permission to view patients from this clinic.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - Clinic not found.'
  })
  async getClinicPatients(@Param('id') id: string, @Req() req: Request) {
    const userId = req.user['sub'];
    return this.clinicService.getClinicPatients(id, userId);
  }

  @Post('register')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Register a patient to a clinic',
    description: 'Registers a patient user to a specific clinic by app name. Used by the mobile app.' 
  })
  @ApiResponse({ 
    status: 201, 
    description: 'The patient has been successfully registered to the clinic.'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Not Found - User or clinic not found.'
  })
  @ApiResponse({ 
    status: 409, 
    description: 'Conflict - User is not a patient.'
  })
  async registerPatientToClinic(
    @Body() data: { appName: string },
    @Req() req: Request,
  ) {
    const userId = req.user['sub'];
    return this.clinicService.registerPatientToClinic({
      userId,
      appName: data.appName,
    });
  }
} 