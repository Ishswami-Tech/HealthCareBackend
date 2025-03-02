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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from '../services/users.service';
import { AuthService } from '../services/auth.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { Roles } from '../../../libs/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { RolesGuard } from 'src/libs/guards/roles.guard';
import { Public } from '../../../libs/decorators/public.decorator';

@ApiTags('users')
@Controller('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, type: UserResponseDto })
  async register(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    return this.authService.register(createUserDto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: { email: string; password: string }) {
    if (!loginDto || !loginDto.email || !loginDto.password) {
      return { statusCode: 400, message: 'Email and password are required' };
    }
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      return { statusCode: 401, message: 'Invalid credentials' };
    }
    const response = await this.authService.login(user);
    return response;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Request() req) {
    return this.authService.logout(req.user.sub);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async getProfile(@Request() req): Promise<UserResponseDto> {
    return this.usersService.findOne(req.user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by id' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete user' })
  async remove(@Param('id') id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  // Role-specific endpoints
  @Get('doctors')
  @ApiOperation({ summary: 'Get all doctors' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async getDoctors(): Promise<UserResponseDto[]> {
    return this.usersService.getDoctors();
  }

  @Get('patients')
  @ApiOperation({ summary: 'Get all patients' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async getPatients(): Promise<UserResponseDto[]> {
    return this.usersService.getPatients();
  }

  @Get('receptionists')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get all receptionists' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async getReceptionists(): Promise<UserResponseDto[]> {
    return this.usersService.getReceptionists();
  }

  @Get('clinic-admins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all clinic admins' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async getClinicAdmins(): Promise<UserResponseDto[]> {
    return this.usersService.getClinicAdmins();
  }
}
