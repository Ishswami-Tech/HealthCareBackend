import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes,
  BadRequestException,
  Query,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ClinicService } from './clinic.service';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { HealthcareErrorsService } from '@core/errors';
import { Role } from '@core/types/enums.types';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
  ApiBody,
  ApiHeader,
  ApiConsumes,
  ApiProduces,
  ApiQuery,
} from '@nestjs/swagger';
import {
  CreateClinicDto,
  AssignClinicAdminDto,
  UpdateClinicDto,
  ClinicListResponseDto,
  AppNameInlineDto,
} from '@dtos/clinic.dto';
import { Public } from '@core/decorators/public.decorator';
import { Cache } from '@core/decorators';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { RbacGuard } from '@core/rbac/rbac.guard';

import { ClinicStatsResponseDto, ClinicOperatingHoursResponseDto } from '@dtos/clinic.dto';
import { ClinicLocationService } from './services/clinic-location.service';

@ApiTags('clinic')
@ApiBearerAuth()
@ApiSecurity('session-id')
@ApiHeader({
  name: 'X-Clinic-ID',
  description: 'Clinic identifier (for clinic-specific endpoints)',
  required: false,
})
@Controller('clinics')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  })
)
export class ClinicController {
  private readonly logger = new Logger(ClinicController.name);

  constructor(
    private readonly clinicService: ClinicService,
    private readonly clinicLocationService: ClinicLocationService,
    private readonly errors: HealthcareErrorsService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('clinics', 'create')
  @ApiOperation({
    summary: 'Create a new clinic',
    description:
      'Creates a new clinic with its own isolated database. Both Super Admins and Clinic Admins can create clinics. Super Admins must specify a clinicAdminIdentifier (email or ID), while Clinic Admins automatically become the admin of the clinic they create. Requires manage_clinics permission.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: CreateClinicDto,
    description: 'Clinic creation data',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The clinic has been successfully created.',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid clinic data or validation errors',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid token or missing session ID',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to create clinics',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'A clinic with the same name, email, or subdomain already exists, or the provided clinicAdminIdentifier is not a Clinic Admin.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Specified Clinic Admin not found.',
  })
  async createClinic(
    @Body() createClinicDto: CreateClinicDto,
    @Req() req: ClinicAuthenticatedRequest
  ): Promise<{
    id: string;
    clinicId: string;
    name: string;
    address: string;
    phone: string;
    email: string;
    subdomain: string;
    app_name: string;
    logo?: string;
    website?: string;
    description?: string;
    timezone: string;
    currency: string;
    language: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    mainLocation: {
      id: string;
      locationId: string;
      name: string;
      address: string;
      city: string;
      state: string;
      country: string;
      zipCode: string;
      phone: string;
      email: string;
      timezone: string;
      workingHours: string;
      isActive: boolean;
      clinicId: string;
      createdAt: Date;
      updatedAt: Date;
    };
    clinicAdminId: string;
  }> {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Creating clinic by user ${userId}`, {
        clinicName: createClinicDto.name,
      });

      const result = (await this.clinicService.createClinic({
        ...createClinicDto,
        subdomain: createClinicDto.subdomain || '',
        app_name: createClinicDto.app_name || createClinicDto.subdomain || '',
        createdBy: userId,
        timezone: createClinicDto.timezone || 'UTC',
        currency: createClinicDto.currency || 'USD',
        language: createClinicDto.language || 'en',
        ...(createClinicDto.communicationConfig && {
          communicationConfig: createClinicDto.communicationConfig,
        }),
      })) as {
        id: string;
        clinicId: string;
        name: string;
        address: string;
        phone: string;
        email: string;
        subdomain: string;
        app_name: string;
        logo?: string;
        website?: string;
        description?: string;
        timezone: string;
        currency: string;
        language: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        mainLocation: {
          id: string;
          locationId: string;
          name: string;
          address: string;
          city: string;
          state: string;
          country: string;
          zipCode: string;
          phone: string;
          email: string;
          timezone: string;
          workingHours: string;
          isActive: boolean;
          clinicId: string;
          createdAt: Date;
          updatedAt: Date;
        };
        clinicAdminId: string;
      };

      this.logger.log(`Clinic created successfully: ${result.id}`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to create clinic: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT)
  @RequireResourcePermission('clinics', 'read')
  @Cache({
    keyTemplate: 'clinics:list:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['clinics'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get all clinics',
    description:
      'Retrieves all clinics based on user permissions. Super Admin can see all clinics, while Clinic Admin can only see their assigned clinics. Supports pagination. Cached for performance.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search clinics by name or email',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns an array of clinics.',
    type: ClinicListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid token or missing session ID',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions to view clinics',
  })
  async getAllClinics(
    @Req() req: ClinicAuthenticatedRequest,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('search') search?: string
  ) {
    try {
      const userId = req.user?.sub;
      const role = req.user?.role;
      // Get clinic ID from context or header for filtering
      const clinicId = req.clinicContext?.clinicId || (req.headers['x-clinic-id'] as string);

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Getting clinics for user ${userId}`, {
        page,
        limit,
        search,
        clinicId,
      });

      const result = await this.clinicService.getAllClinics(userId, role, clinicId);

      this.logger.log(
        `Retrieved ${Array.isArray(result) ? result.length : 0} clinics for user ${userId}`
      );
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get clinics: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        _error instanceof Error ? _error.stack : ''
      );
      throw _error;
    }
  }

  @Get('my-clinic')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.CLINIC_ADMIN, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST)
  @RequireResourcePermission('clinics', 'read')
  @Cache({
    keyTemplate: 'clinic:my:{userId}',
    ttl: 1800, // 30 minutes
    tags: ['clinics', 'user_clinic'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get current user clinic',
    description:
      'Get clinic details for the currently authenticated user. Patients, doctors, and staff can access their associated clinic. Cached for performance.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Returns the user's clinic data.",
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to view clinic.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User is not associated with any clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not associated with any clinic.',
  })
  async getMyClinic(@Req() req: ClinicAuthenticatedRequest) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Getting clinic for user ${userId}`);

      const result = await this.clinicService.getCurrentUserClinic(userId);

      this.logger.log(`Retrieved clinic for user ${userId} successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get user clinic: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.PATIENT)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'clinic:{id}',
    ttl: 3600, // 1 hour
    tags: ['clinics', 'clinic:{id}'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get a clinic by ID',
    description:
      'Retrieves a specific clinic by ID based on user permissions. Super Admin can see any clinic, Clinic Admin can see their assigned clinics, and Patients can see their associated clinic.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic to retrieve',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the clinic data.',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid clinic ID format',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to view this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User is not associated with this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async getClinicById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;
      const role = req.user?.role;
      const clinicId = req.clinicContext?.clinicId || (req.headers['x-clinic-id'] as string);

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Getting clinic ${id} for user ${userId}`);

      const result = await this.clinicService.getClinicById(id, false, userId, role, clinicId);

      this.logger.log(`Retrieved clinic ${id} successfully`);
      return result;
    } catch (_error) {
      // Re-throw ForbiddenException directly
      if (_error instanceof ForbiddenException) {
        throw _error;
      }
      this.logger.error(
        `Failed to get clinic ${id}: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        _error instanceof Error ? _error.stack : ''
      );
      throw _error;
    }
  }

  @Get(':id/stats')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get clinic statistics',
    description:
      'Retrieves key statistics for a clinic, including totals and revenue. Requires CLINIC_ADMIN or SUPER_ADMIN role.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns clinic statistics.',
    type: ClinicStatsResponseDto,
  })
  async getClinicStats(@Param('id', ParseUUIDPipe) id: string): Promise<ClinicStatsResponseDto> {
    try {
      this.logger.log(`Getting stats for clinic ${id}`);
      return await this.clinicService.getClinicStats(id);
    } catch (_error) {
      this.logger.error(`Failed to get clinic stats: ${(_error as Error).message}`);
      throw _error;
    }
  }

  @Get(':id/operating-hours')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.PATIENT)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get clinic operating hours',
    description: 'Retrieves operating hours for all locations in the clinic.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns clinic operating hours by location.',
    type: [ClinicOperatingHoursResponseDto],
  })
  async getClinicOperatingHours(
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ClinicOperatingHoursResponseDto[]> {
    try {
      this.logger.log(`Getting operating hours for clinic ${id}`);
      return await this.clinicLocationService.getClinicOperatingHours(id);
    } catch (_error) {
      this.logger.error(`Failed to get clinic operating hours: ${(_error as Error).message}`);
      throw _error;
    }
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('clinics', 'update', { requireOwnership: true })
  @ApiOperation({
    summary: 'Update a clinic',
    description:
      'Updates a specific clinic by ID. Super Admin can update any clinic, while Clinic Admin can only update their assigned clinics.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic to update',
    type: 'string',
    format: 'uuid',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: UpdateClinicDto,
    description: 'Clinic update data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the updated clinic data.',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid update data',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to update this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async updateClinic(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateClinicDto: UpdateClinicDto,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Updating clinic ${id} by user ${userId}`);

      const result = await this.clinicService.updateClinic(id, {
        ...updateClinicDto,
        ...(updateClinicDto.communicationConfig && {
          communicationConfig: updateClinicDto.communicationConfig,
        }),
      });

      this.logger.log(`Clinic ${id} updated successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to update clinic ${id}: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        _error instanceof Error ? _error.stack : ''
      );
      throw _error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('clinics', 'delete', { requireOwnership: true })
  @ApiOperation({
    summary: 'Delete a clinic',
    description:
      'Deletes a specific clinic by ID and its associated database. Only Super Admin can delete clinics.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic to delete',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns a success message.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Only Super Admin can delete clinics.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async deleteClinic(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Deleting clinic ${id} by user ${userId}`);

      await this.clinicService.deleteClinic(id);

      this.logger.log(`Clinic ${id} deleted successfully`);
      return { message: 'Clinic deleted successfully' };
    } catch (_error) {
      this.logger.error(
        `Failed to delete clinic ${id}: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        _error instanceof Error ? _error.stack : ''
      );
      throw _error;
    }
  }

  @Post('admin')
  @HttpCode(HttpStatus.CREATED)
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('clinics', 'create')
  @ApiOperation({
    summary: 'Assign a clinic admin',
    description:
      'Assigns a user as a clinic admin. Only Super Admin or the clinic owner can assign clinic admins.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: AssignClinicAdminDto,
    description: 'Clinic admin assignment data',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The clinic admin has been successfully assigned.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid assignment data',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to assign clinic admins.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User or clinic not found.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User is already assigned to this clinic or does not have the correct role.',
  })
  async assignClinicAdmin(
    @Body() data: AssignClinicAdminDto,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const assignedBy = req.user?.sub;

      if (!assignedBy) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Assigning clinic admin by user ${assignedBy}`, {
        userId: data.userId,
        clinicId: data.clinicId,
      });

      const result = await this.clinicService.assignClinicAdmin(data);

      this.logger.log(`Clinic admin assigned successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to assign clinic admin: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get('app/:appName')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: 'Get a clinic by app name',
    description:
      'Retrieves a specific clinic by app name (subdomain). This endpoint is public and used to determine which clinic database to connect to.',
  })
  @ApiParam({
    name: 'appName',
    description: 'The app name (subdomain) of the clinic to retrieve',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the clinic data.',
    type: Object,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async getClinicByAppName(@Param('appName') appName: string) {
    try {
      if (!appName) {
        throw new BadRequestException('App name is required');
      }

      this.logger.log(`Getting clinic by app name: ${appName}`);

      const result = await this.clinicService.getClinicByAppName(appName);

      this.logger.log(`Retrieved clinic by app name ${appName} successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get clinic by app name ${appName}: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get(':id/doctors')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.PATIENT)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'clinic:{id}:doctors',
    ttl: 1800, // 30 minutes
    tags: ['clinics', 'clinic:{id}', 'doctors'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get all doctors for a clinic',
    description:
      'Retrieves all doctors associated with a specific clinic. Super Admin, Clinic Admin, Receptionist, and Patients can see all doctors. Cached for performance.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns an array of doctors.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to view doctors from this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async getClinicDoctors(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Getting doctors for clinic ${id} by user ${userId}`);

      const result = await this.clinicService.getClinicDoctors(id, userId);

      this.logger.log(`Retrieved ${result?.length || 0} doctors for clinic ${id}`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get clinic doctors for clinic ${id}: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get(':id/staff')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @ApiOperation({
    summary: 'Get all staff for a clinic',
    description:
      'Retrieves all staff members (doctors, receptionists, pharmacists, etc.) associated with the clinic.',
  })
  @ApiParam({ name: 'id', description: 'Clinic ID', type: 'string' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Returns an array of staff members.' })
  async getClinicStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new BadRequestException('User ID is required');
      }
      const result = await this.clinicService.getClinicStaff(id, userId);
      this.logger.log(`Retrieved ${result?.length || 0} staff for clinic ${id}`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get clinic staff for clinic ${id}: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Get(':id/patients')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.ASSISTANT_DOCTOR)
  @RequireResourcePermission('clinics', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'clinic:{id}:patients',
    ttl: 1800, // 30 minutes
    tags: ['clinics', 'clinic:{id}', 'patients'],
    enableSWR: true,
    containsPHI: true,
  })
  @ApiOperation({
    summary: 'Get all patients for a clinic',
    description:
      'Retrieves all patients associated with a specific clinic. Super Admin and Clinic Admin can see all patients. Cached for performance.',
  })
  @ApiParam({
    name: 'id',
    description: 'The ID of the clinic',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns an array of patients.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User does not have permission to view patients from this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async getClinicPatients(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ClinicAuthenticatedRequest
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      this.logger.log(`Getting patients for clinic ${id} by user ${userId}`);

      const result = await this.clinicService.getClinicPatients(id, userId);

      this.logger.log(
        `Retrieved ${Array.isArray(result) ? result.length : 0} patients for clinic ${id}`
      );
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to get clinic patients for clinic ${id}: ${(_error as Error).message}`,
        (_error as Error).stack
      );
      throw _error;
    }
  }

  @Post('validate-app-name')
  @HttpCode(HttpStatus.OK)
  @Public()
  @ApiOperation({
    summary: 'Validate app name',
    description:
      'Validates if an app name (subdomain) is available and returns clinic information.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: AppNameInlineDto,
    description: 'App name validation data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns clinic information if app name is valid.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid app name format',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'App name not found.',
  })
  async validateAppName(@Body() data: AppNameInlineDto) {
    try {
      if (!data.appName) {
        throw new BadRequestException('App name is required');
      }

      this.logger.log(`Validating app name: ${data.appName}`);

      const clinic = await this.clinicService.getClinicByAppName(data.appName);

      // Return only necessary information with type-safe access
      const clinicWithId = 'id' in clinic && typeof clinic.id === 'string' ? clinic.id : '';
      const clinicName = 'name' in clinic && typeof clinic.name === 'string' ? clinic.name : '';
      const clinicSettings =
        'settings' in clinic && typeof clinic.settings === 'object' && clinic.settings !== null
          ? (clinic.settings as Record<string, unknown>)
          : {};

      const result = {
        clinicId: clinicWithId,
        name: clinicName,
        locations: await this.clinicService.getActiveLocations(clinicWithId),
        settings: clinicSettings,
      };

      this.logger.log(`App name ${data.appName} validated successfully`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to validate app name ${data.appName}: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  @Post('associate-user')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PATIENT, Role.DOCTOR, Role.ASSISTANT_DOCTOR, Role.RECEPTIONIST, Role.CLINIC_ADMIN)
  @RequireResourcePermission('clinics', 'read')
  @ApiOperation({
    summary: 'Associate user with clinic by app name',
    description:
      'Associates the current user with a clinic by app name. Users can associate themselves with clinics they have access to.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({
    type: AppNameInlineDto,
    description: 'Clinic association data',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User successfully associated with clinic.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid association data',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Cannot associate with this clinic.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Clinic not found.',
  })
  async associateUser(@Body() data: AppNameInlineDto, @Req() req: ClinicAuthenticatedRequest) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new BadRequestException('User ID is required');
      }

      if (!data.appName) {
        throw new BadRequestException('App name is required');
      }

      this.logger.log(`Associating user ${userId} with clinic by app name: ${data.appName}`);

      const result = await this.clinicService.associateUserWithClinic({
        userId,
        clinicId: data.appName,
      });

      this.logger.log(`User ${userId} associated with clinic ${data.appName} successfully`);
      return result;
    } catch (_error) {
      this.logger.error(
        `Failed to associate user with clinic: ${_error instanceof Error ? _error.message : 'Unknown _error'}`,
        _error instanceof Error ? _error.stack : ''
      );
      throw _error;
    }
  }

  @Get('test/context')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.PATIENT
  )
  @RequireResourcePermission('clinics', 'read')
  @ApiOperation({
    summary: 'Test clinic context',
    description: 'Test endpoint to debug clinic context and permissions',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the current clinic context and user info.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized',
  })
  testClinicContext(@Req() req: ClinicAuthenticatedRequest) {
    const clinicContext = req.clinicContext;
    const user = req.user;

    return {
      message: 'Clinic context test',
      timestamp: new Date().toISOString(),
      user: {
        id: user?.sub,
        sub: user?.sub,
        role: user?.role,
        email: user?.['email'],
      },
      clinicContext: {
        identifier: clinicContext?.identifier,
        clinicId: clinicContext?.clinicId,
        subdomain: clinicContext?.subdomain,
        appName: clinicContext?.appName,
        isValid: clinicContext?.isValid,
      },
      headers: {
        'x-clinic-id': req.headers['x-clinic-id'],
        'x-clinic-identifier': req.headers['x-clinic-identifier'],
        authorization: req.headers.authorization ? 'Bearer ***' : 'none',
      },
    };
  }
}
