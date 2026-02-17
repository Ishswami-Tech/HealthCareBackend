import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Put,
  ForbiddenException,
  BadRequestException,
  Res,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiSecurity,
} from '@nestjs/swagger';
import { UsersService } from '@services/users/users.service';
import { AuthService } from '@services/auth/auth.service';
import type { FastifyReply } from 'fastify';
import type { JwtGuardUser } from '@core/types/guard.types';
import { LocationManagementService } from '../services/location-management.service';
import {
  UserResponseDto,
  UpdateUserRoleDto,
  CreateUserDto,
  UpdateUserProfileDto,
} from '@dtos/user.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { ClinicId, OptionalClinicId } from '@core/decorators/clinic.decorator';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { Role } from '@core/types/enums.types';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { RbacService } from '@core/rbac/rbac.service';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { PatientCache, InvalidatePatientCache } from '@core/decorators';

@ApiTags('Users')
@Controller('user')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
    private readonly rbacService: RbacService,
    private readonly locationManagementService: LocationManagementService
  ) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('users', 'create')
  @ApiOperation({
    summary: 'Create user',
    description: 'Create a new user. Only accessible by Super Admin and Clinic Admin.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Validation failed',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async create(
    @Body() createUserDto: CreateUserDto,
    @Request() req: ClinicAuthenticatedRequest,
    @ClinicId() clinicId: string
  ): Promise<UserResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    return this.usersService.createUser(createUserDto, userId, clinicId);
  }

  @Get('all')
  @RateLimitAPI()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('users', 'read')
  @PatientCache({
    keyTemplate: 'users:all:{role}:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['users', 'user_lists'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get all users',
    description: 'Retrieve a list of all users. Only accessible by Super Admin and Clinic Admin.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of users retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid token or missing session ID',
  })
  async findAll(@OptionalClinicId() clinicId?: string): Promise<UserResponseDto[]> {
    return this.usersService.findAll(undefined, clinicId);
  }

  @Get('search')
  @RequireResourcePermission('users', 'read')
  @ApiOperation({ summary: 'Search users', description: 'Search users by name, email, or phone.' })
  @ApiResponse({ status: 200, description: 'Return search results.' })
  async search(
    @Query('q') query: string,
    @Query('roles') roles?: Role[],
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @OptionalClinicId() clinicId?: string
  ) {
    return this.usersService.search(query, clinicId, roles, limit, offset);
  }

  @Get('stats')
  @RequireResourcePermission('users', 'read')
  @ApiOperation({
    summary: 'Get user statistics',
    description: 'Get user counts by role and status.',
  })
  @ApiResponse({ status: 200, description: 'Return user statistics.' })
  async getStats(@OptionalClinicId() clinicId?: string) {
    return this.usersService.getStats(clinicId);
  }

  @Get('profile')
  @RequireResourcePermission('profile', 'read', { requireOwnership: true })
  @PatientCache({
    keyTemplate: 'user:{userId}:profile',
    ttl: 1800, // 30 minutes
    tags: ['user_profiles', 'users'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get user profile',
    description:
      'Retrieve the profile of the currently authenticated user. Cached for performance.',
    operationId: 'getUserProfile',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User ID not found in token',
  })
  async getProfile(@Request() req: ClinicAuthenticatedRequest): Promise<UserResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    return this.usersService.findOne(userId);
  }

  @Get(':id')
  @RequireResourcePermission('users', 'read')
  @PatientCache({
    keyTemplate: 'users:one:{id}:{clinicId}',
    ttl: 3600, // 1 hour
    tags: ['users', 'user_details'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Retrieve a specific user by their unique identifier',
  })
  @ApiResponse({
    status: 200,
    description: 'User found and retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(
    @Param('id') id: string,
    @OptionalClinicId() clinicId?: string
  ): Promise<UserResponseDto> {
    return this.usersService.findOne(id, clinicId);
  }

  @Get(':id/activity')
  @RequireResourcePermission('users', 'read')
  @ApiOperation({
    summary: 'Get user activity',
    description: 'Get recent activity logs for a user.',
  })
  @ApiResponse({ status: 200, description: 'Return user activity logs.' })
  async getUserActivity(@Param('id') id: string) {
    return this.usersService.getUserActivity(id);
  }

  @Patch(':id')
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'update', { requireOwnership: true })
  @InvalidatePatientCache({
    patterns: ['users:one:{id}', 'users:all:*', 'user:{id}:*'],
    tags: ['users', 'user_details', 'user_lists'],
  })
  @ApiOperation({
    summary: 'Update user',
    description:
      'Update user information. Super Admin can update any user. All authenticated users can update their own information.',
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserProfileDto,
    @Request() req: ClinicAuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<UserResponseDto> {
    if (!id || id === 'undefined') {
      throw new BadRequestException('User ID is required in the URL');
    }
    const loggedInUser = req.user;
    // Use user.sub (JWT subject) as userId, fallback to user.id
    const loggedInUserId = loggedInUser.sub || loggedInUser.id;

    if (!loggedInUserId) {
      throw new ForbiddenException('User ID not found in token');
    }

    // Allow Super Admin to update any user
    if (loggedInUser.role === Role.SUPER_ADMIN) {
      const updatedUser = await this.usersService.update(id, updateUserDto);
      // If profile is complete, refresh session
      if (this.authService.isProfileComplete(updatedUser)) {
        const fullProfile = await this.authService.getUserProfile(id);
        const sessionId = (req.user as JwtGuardUser)?.sessionId || 'unknown';
        const tokens = await this.authService.generateTokens(
          fullProfile,
          sessionId,
          req.headers['x-device-fingerprint'] as string,
          req.headers['user-agent'],
          req.ip
        );
        this.authService.setAuthCookies(reply, tokens);
      }
      return updatedUser;
    }
    // Allow any user to update their own profile
    if (loggedInUserId === id) {
      const updatedUser = await this.usersService.update(id, updateUserDto);
      // If profile is complete, refresh session
      if (this.authService.isProfileComplete(updatedUser)) {
        const fullProfile = await this.authService.getUserProfile(id);
        const sessionId = (req.user as JwtGuardUser)?.sessionId || 'unknown';
        const tokens = await this.authService.generateTokens(
          fullProfile,
          sessionId,
          req.headers['x-device-fingerprint'] as string,
          req.headers['user-agent'],
          req.ip
        );
        this.authService.setAuthCookies(reply, tokens);
      }
      return updatedUser;
    }
    // Otherwise, forbidden
    throw new ForbiddenException('You do not have permission to update this user.');
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('users', 'delete')
  @ApiOperation({
    summary: 'Delete user',
    description: 'Permanently delete a user. Only accessible by Super Admin.',
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @Get('role/patient')
  @RequireResourcePermission('patients', 'read')
  @PatientCache({
    keyTemplate: 'users:role:patient:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['users', 'user_lists', 'patients'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get all patients',
    description:
      'Retrieve a list of all users with the patient role, scoped to the current clinic.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of patients retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  async getPatients(@OptionalClinicId() clinicId?: string): Promise<UserResponseDto[]> {
    return this.usersService.getPatients(clinicId);
  }

  @Get('role/doctors')
  @RequireResourcePermission('users', 'read')
  @PatientCache({
    keyTemplate: 'users:role:doctors:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['users', 'user_lists', 'doctors'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get all doctors',
    description:
      'Retrieves a list of all users with the Doctor role, scoped to the current clinic.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of doctors retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  async getDoctors(@OptionalClinicId() clinicId?: string): Promise<UserResponseDto[]> {
    return this.usersService.getDoctors(clinicId);
  }

  @Get('role/receptionists')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('users', 'read')
  @PatientCache({
    keyTemplate: 'users:role:receptionists:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['users', 'user_lists', 'receptionists'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get all receptionists',
    description:
      'Retrieves a list of all users with the Receptionist role, scoped to the current clinic.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of receptionists retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async getReceptionists(@OptionalClinicId() clinicId?: string): Promise<UserResponseDto[]> {
    return this.usersService.getReceptionists(clinicId);
  }

  @Get('role/clinic-admins')
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('users', 'read')
  @PatientCache({
    keyTemplate: 'users:role:clinic-admins:{clinicId}',
    ttl: 1800, // 30 minutes
    tags: ['users', 'user_lists', 'clinic_admins'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get all clinic admins',
    description:
      'Retrieves a list of all users with the Clinic Admin role. Only accessible by Super Admin.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of clinic admins retrieved successfully',
    type: [UserResponseDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  async getClinicAdmins(@OptionalClinicId() clinicId?: string): Promise<UserResponseDto[]> {
    return this.usersService.getClinicAdmins(clinicId);
  }

  @Put(':id/role')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('users', 'update')
  @ApiOperation({
    summary: 'Update user role',
    description:
      "Update a user's role. Super Admin can assign any role. Clinic Admin can assign roles to staff within their clinic only (DOCTOR, ASSISTANT_DOCTOR, RECEPTIONIST, PHARMACIST, NURSE).",
  })
  @ApiBody({ type: UpdateUserRoleDto })
  @ApiResponse({
    status: 200,
    description: 'User role updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Missing required fields for the specified role',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Insufficient permissions',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async updateUserRole(
    @Param('id') id: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
    @Request() req: ClinicAuthenticatedRequest,
    @OptionalClinicId() clinicId?: string
  ): Promise<UserResponseDto> {
    const minimalCreateUserDto = {
      email: 'placeholder@example.com',
      password: 'placeholder',
      firstName: 'placeholder',
      lastName: 'placeholder',
      phone: '0000000000',
      role: updateUserRoleDto.role,
      clinicId: updateUserRoleDto.clinicId ?? clinicId ?? '',
    };
    const createUserData = {
      email: minimalCreateUserDto.email,
      password: minimalCreateUserDto.password,
      firstName: minimalCreateUserDto.firstName,
      lastName: minimalCreateUserDto.lastName,
      phone: minimalCreateUserDto.phone,
      role: minimalCreateUserDto.role,
      ...(minimalCreateUserDto.clinicId && {
        clinicId: minimalCreateUserDto.clinicId,
      }),
    };
    const currentUserId = req.user?.sub || req.user?.id;
    return this.usersService.updateUserRole(
      id,
      updateUserRoleDto.role,
      createUserData,
      currentUserId,
      clinicId
    );
  }

  @Post(':id/change-location')
  @RateLimitAPI()
  @Roles(Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @RequireResourcePermission('users', 'change-location')
  @ApiOperation({
    summary: 'Change user location',
    description:
      'Change the location assignment for a staff user. Only accessible by Clinic Admin and Super Admin.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        locationId: {
          type: 'string',
          format: 'uuid',
          description: 'New location ID',
        },
      },
      required: ['locationId'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Location changed successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Only clinic admin or super admin can change locations',
  })
  @ApiResponse({ status: 404, description: 'User or location not found' })
  async changeUserLocation(
    @Param('id') userId: string,
    @Body() body: { locationId: string },
    @ClinicId() clinicId: string,
    @Request() request: ClinicAuthenticatedRequest
  ): Promise<{ success: boolean; message: string }> {
    const currentUserId = request.user?.id || request.user?.sub || '';

    await this.locationManagementService.changeUserLocation(
      userId,
      body.locationId,
      currentUserId,
      clinicId
    );

    return {
      success: true,
      message: 'User location changed successfully',
    };
  }
}
