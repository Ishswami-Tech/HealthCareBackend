import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Put,
  ForbiddenException,
  BadRequestException,
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
import { UpdateUserDto, UserResponseDto, UpdateUserRoleDto } from '@dtos/user.dto';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import { Role } from '@core/types/enums.types';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { RbacService } from '@core/rbac/rbac.service';
import { RateLimitAPI } from '@security/rate-limit/rate-limit.decorator';
import { PatientCache, InvalidatePatientCache } from '@core/decorators';

@ApiTags('user')
@Controller('user')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rbacService: RbacService
  ) {}

  @Get('all')
  @RateLimitAPI()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @PatientCache({
    keyTemplate: 'users:all:{role}',
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
  async findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get('profile')
  @ApiOperation({
    summary: 'Get user profile',
    description: 'Retrieve the profile of the currently authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  async getProfile(@Request() req: ClinicAuthenticatedRequest): Promise<UserResponseDto> {
    const userId = req.user.sub || req.user.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    return this.usersService.findOne(userId);
  }

  @Get(':id')
  @PatientCache({
    keyTemplate: 'users:one:{id}',
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
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
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
    @Body() updateUserDto: UpdateUserDto,
    @Request() req: ClinicAuthenticatedRequest
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
      return this.usersService.update(id, updateUserDto);
    }
    // Allow any user to update their own profile
    if (loggedInUserId === id) {
      return this.usersService.update(id, updateUserDto);
    }
    // Otherwise, forbidden
    throw new ForbiddenException('You do not have permission to update this user.');
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
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
  @ApiOperation({
    summary: 'Get all patients',
    description: 'Retrieve a list of all users with the patient role. No parameters required.',
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
  async getPatients(): Promise<UserResponseDto[]> {
    return this.usersService.getPatients();
  }

  @Get('role/doctors')
  @ApiOperation({
    summary: 'Get all doctors',
    description: 'Retrieves a list of all users with the Doctor role. No parameters required.',
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
  async getDoctors(): Promise<UserResponseDto[]> {
    return this.usersService.getDoctors();
  }

  @Get('role/receptionists')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({
    summary: 'Get all receptionists',
    description:
      'Retrieves a list of all users with the Receptionist role. Only accessible by Super Admin and Clinic Admin. No parameters required.',
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
  async getReceptionists(): Promise<UserResponseDto[]> {
    return this.usersService.getReceptionists();
  }

  @Get('role/clinic-admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get all clinic admins',
    description:
      'Retrieves a list of all users with the Clinic Admin role. Only accessible by Super Admin. No parameters required.',
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
  async getClinicAdmins(): Promise<UserResponseDto[]> {
    return this.usersService.getClinicAdmins();
  }

  @Put(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update user role',
    description:
      "Update a user's role and associated role-specific information. Only accessible by Super Admin.",
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
    @Body() updateUserRoleDto: UpdateUserRoleDto
  ): Promise<UserResponseDto> {
    const minimalCreateUserDto = {
      email: 'placeholder@example.com',
      password: 'placeholder',
      firstName: 'placeholder',
      lastName: 'placeholder',
      phone: '0000000000',
      role: updateUserRoleDto.role,
      clinicId: updateUserRoleDto.clinicId,
    };
    // Handle clinicId properly for exactOptionalPropertyTypes
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

    return this.usersService.updateUserRole(id, updateUserRoleDto.role, createUserData);
  }
}
