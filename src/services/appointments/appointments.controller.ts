import { Controller, Get, Post, Put, Delete, Body, Param, Query, Logger } from '@nestjs/common';
import { AppointmentService } from './appointments.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/libs/guards/jwt-auth.guard';
import { RolesGuard } from 'src/libs/guards/roles.guard';
import { Roles } from 'src/libs/decorators/roles.decorator';

@ApiTags('Appointment')
@Controller('api/appointments')
export class AppointmentController {
  private readonly logger = new Logger(AppointmentController.name);

  constructor(
    private readonly appointmentService: AppointmentService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PATIENT, Role.RECEPTIONIST)
  @ApiOperation({
    summary: 'Create new appointment',
    description: 'Create a new appointment with the specified details'
  })
  @ApiResponse({
    status: 201,
    description: 'Appointment created successfully'
  })
  async createAppointment(
    @Body() appointmentData: {
      userId: string;
      doctorId: string;
      locationId: string;
      date: string;
      time: string;
      duration: number;
      type: string;
      notes?: string;
      clinicId: string;
    }
  ) {
    try {
      return await this.appointmentService.createAppointment(appointmentData);
    } catch (error) {
      this.logger.error(`Failed to create appointment: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Get appointments',
    description: 'Get appointments with optional filtering'
  })
  @ApiQuery({ name: 'userId', required: false, description: 'Filter by user ID' })
  @ApiQuery({ name: 'doctorId', required: false, description: 'Filter by doctor ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by appointment status' })
  @ApiQuery({ name: 'locationId', required: false, description: 'Filter by location ID' })
  @ApiQuery({ name: 'date', required: false, description: 'Filter by date' })
  async getAppointments(
    @Query('userId') userId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('status') status?: string,
    @Query('locationId') locationId?: string,
    @Query('date') date?: string,
  ) {
    try {
      return await this.appointmentService.getAppointments({
        userId,
        doctorId,
        status,
        locationId,
        date,
      });
    } catch (error) {
      this.logger.error(`Failed to get appointments: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':appointmentId')
  @ApiOperation({
    summary: 'Get appointment by ID',
    description: 'Get detailed information about a specific appointment'
  })
  @ApiParam({ name: 'appointmentId', description: 'ID of the appointment to retrieve' })
  async getAppointmentById(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.appointmentService.getAppointmentById(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to get appointment ${appointmentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':appointmentId')
  @ApiOperation({
    summary: 'Update appointment',
    description: 'Update an existing appointment\'s details'
  })
  @ApiParam({ name: 'appointmentId', description: 'ID of the appointment to update' })
  async updateAppointment(
    @Param('appointmentId') appointmentId: string,
    @Body() updateData: {
      date?: string;
      time?: string;
      duration?: number;
      status?: string;
      notes?: string;
    },
  ) {
    try {
      return await this.appointmentService.updateAppointment(appointmentId, updateData);
    } catch (error) {
      this.logger.error(`Failed to update appointment ${appointmentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':appointmentId')
  @ApiOperation({
    summary: 'Cancel appointment',
    description: 'Cancel an existing appointment'
  })
  @ApiParam({ name: 'appointmentId', description: 'ID of the appointment to cancel' })
  async cancelAppointment(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.appointmentService.cancelAppointment(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to cancel appointment ${appointmentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('doctor/:doctorId/availability')
  @ApiOperation({
    summary: 'Get doctor availability',
    description: 'Check a doctor\'s availability for a specific date'
  })
  @ApiParam({ name: 'doctorId', description: 'ID of the doctor' })
  @ApiQuery({ name: 'date', description: 'Date to check availability for' })
  async getDoctorAvailability(
    @Param('doctorId') doctorId: string,
    @Query('date') date: string,
  ) {
    try {
      return await this.appointmentService.getDoctorAvailability(doctorId, date);
    } catch (error) {
      this.logger.error(`Failed to get doctor availability: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('user/:userId/upcoming')
  async getUserUpcomingAppointments(@Param('userId') userId: string) {
    try {
      return await this.appointmentService.getUserUpcomingAppointments(userId);
    } catch (error) {
      this.logger.error(`Failed to get user appointments: ${error.message}`, error.stack);
      throw error;
    }
  }
}