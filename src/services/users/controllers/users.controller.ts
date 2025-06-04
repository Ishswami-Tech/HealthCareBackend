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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiSecurity } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { UpdateUserDto, UserResponseDto, CreateUserDto } from '../../../libs/dtos/user.dto';
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ 
    summary: 'Update user',
    description: 'Update user information. Only accessible by Super Admin and Clinic Admin.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'User updated successfully',
    type: UserResponseDto 
  })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto
  ): Promise<UserResponseDto> {
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
  @ApiBody({
    schema: {
      type: 'object',
      required: ['role'],
      properties: {
        role: { 
          type: 'string', 
          enum: ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN', 'SUPER_ADMIN'],
          description: 'The new role to assign to the user'
        },
        // Include role-specific fields from CreateUserDto
        specialization: { type: 'string', description: 'Doctor specialization (required for DOCTOR role)' },
        licenseNumber: { type: 'string', description: 'Doctor license number (required for DOCTOR role)' },
        clinicId: { type: 'string', description: 'Clinic ID (required for CLINIC_ADMIN role)' }
      }
    }
  })
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
    @Body('role') role: Role,
    @Body() createUserDto: CreateUserDto
  ): Promise<UserResponseDto> {
    return this.usersService.updateUserRole(id, role, createUserDto);
  }
}
