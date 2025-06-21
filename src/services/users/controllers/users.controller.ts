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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { UsersService } from '../users.service';
import { UpdateUserDto, UserResponseDto, CreateUserDto, UpdateUserRoleDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { Roles } from '../../../libs/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RolesGuard } from '../../../libs/guards/roles.guard';

@ApiTags('user')
@Controller('user')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Get all users',
    description: 'Retrieve a list of all users. Only accessible by Super Admin and Clinic Admin.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of users retrieved successfully',
    type: [UserResponseDto] 
  })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid token or missing session ID' })
  async findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get('profile')
  @ApiOperation({ 
    summary: 'Get user profile',
    description: 'Retrieve the profile of the currently authenticated user'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'User profile retrieved successfully',
    type: UserResponseDto 
  })
  async getProfile(@Request() req): Promise<UserResponseDto> {
    return this.usersService.findOne(req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get user by ID',
    description: 'Retrieve a specific user by their unique identifier'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'User found and retrieved successfully',
    type: UserResponseDto 
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update user',
    description: 'Update user information. Admins can update any user. All authenticated users can update their own information.',
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserResponseDto,
  })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() req,
  ): Promise<UserResponseDto> {
    const loggedInUser = req.user;

    // Allow if user is Super Admin, Clinic Admin, or updating their own profile
    if (
      loggedInUser.role !== Role.SUPER_ADMIN &&
      loggedInUser.role !== Role.CLINIC_ADMIN &&
      loggedInUser.id !== id
    ) {
      throw new ForbiddenException('You do not have permission to update this user.');
    }

    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Delete user',
    description: 'Permanently delete a user. Only accessible by Super Admin.'
  })
  @ApiResponse({ status: 200, description: 'User deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @Get('role/patient')
  @ApiOperation({ 
    summary: 'Get all patients',
    description: 'Retrieve a list of all users with the patient role. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of patients retrieved successfully',
    type: [UserResponseDto] 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  async getPatients(): Promise<UserResponseDto[]> {
    return this.usersService.getPatients();
  }

  @Get('role/doctors')
  @ApiOperation({ 
    summary: 'Get all doctors',
    description: 'Retrieves a list of all users with the Doctor role. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of doctors retrieved successfully',
    type: [UserResponseDto] 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  async getDoctors(): Promise<UserResponseDto[]> {
    return this.usersService.getDoctors();
  }

  @Get('role/receptionists')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Get all receptionists',
    description: 'Retrieves a list of all users with the Receptionist role. Only accessible by Super Admin and Clinic Admin. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of receptionists retrieved successfully',
    type: [UserResponseDto] 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async getReceptionists(): Promise<UserResponseDto[]> {
    return this.usersService.getReceptionists();
  }

  @Get('role/clinic-admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Get all clinic admins',
    description: 'Retrieves a list of all users with the Clinic Admin role. Only accessible by Super Admin. No parameters required.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'List of clinic admins retrieved successfully',
    type: [UserResponseDto] 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  async getClinicAdmins(): Promise<UserResponseDto[]> {
    return this.usersService.getClinicAdmins();
  }

  @Put(':id/role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ 
    summary: 'Update user role',
    description: 'Update a user\'s role and associated role-specific information. Only accessible by Super Admin.'
  })
  @ApiBody({ type: UpdateUserRoleDto })
  @ApiResponse({ 
    status: 200, 
    description: 'User role updated successfully',
    type: UserResponseDto 
  })
  @ApiResponse({ status: 400, description: 'Bad request - Missing required fields for the specified role' })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
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
      role: updateUserRoleDto.role as Role,
      clinicId: updateUserRoleDto.clinicId,
    };
    return this.usersService.updateUserRole(id, updateUserRoleDto.role as Role, minimalCreateUserDto);
  }
}
