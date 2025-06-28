import { Controller, Get, Post, Put, Delete, Body, Param, Query, Logger, Request } from '@nestjs/common';
import { AppointmentService } from './appointments.service';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { UseGuards } from '@nestjs/common';
import { Role } from '../../shared/database/prisma/prisma.types';
import { JwtAuthGuard } from 'src/libs/guards/jwt-auth.guard';
import { RolesGuard } from 'src/libs/guards/roles.guard';
import { Roles } from 'src/libs/decorators/roles.decorator';
import { ClinicGuard } from '../../libs/guards/clinic.guard';
import { ClinicRoute } from '../../libs/decorators/clinic-route.decorator';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from '../../shared/interceptors/tenant-context.interceptor';
import { CreateAppointmentDto, UpdateAppointmentDto } from './appointment.dto';

@ApiTags('appointments')
@Controller('appointments')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(TenantContextInterceptor)
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);

  constructor(
    private readonly appointmentService: AppointmentService,
  ) {}

  @Post()
  @ClinicRoute()
  @ApiOperation({
    summary: 'Create a new appointment',
    description: 'Create a new appointment with the specified details'
  })
  @ApiBody({ type: CreateAppointmentDto })
  @ApiResponse({
    status: 201,
    description: 'Appointment created successfully'
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiBearerAuth()
  async createAppointment(@Body() appointmentData: CreateAppointmentDto, @Request() req) {
    try {
      const clinicId = req.clinicContext?.clinicId;
      return await this.appointmentService.createAppointment({
        userId: req.user.id,
        doctorId: appointmentData.doctorId,
        locationId: appointmentData.locationId,
        date: appointmentData.date,
        time: appointmentData.time,
        duration: appointmentData.duration,
        type: appointmentData.type,
        notes: appointmentData.notes,
        clinicId: clinicId,
      });
    } catch (error) {
      this.logger.error(`Failed to create appointment: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ClinicRoute()
  @ApiOperation({
    summary: 'Get all appointments',
    description: 'Get appointments with optional filtering'
  })
  @ApiResponse({ status: 200, description: 'Return all appointments' })
  @ApiBearerAuth()
  async getAppointments(@Request() req) {
    try {
      // Get clinic ID from the request context
      const clinicId = req.clinicContext?.clinicId;
      
      return await this.appointmentService.getAppointments({
        ...req.query,
        clinicId: clinicId,
      });
    } catch (error) {
      this.logger.error(`Failed to get appointments: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':id')
  @ClinicRoute()
  @ApiOperation({
    summary: 'Get an appointment by ID',
    description: 'Get detailed information about a specific appointment'
  })
  @ApiResponse({ status: 200, description: 'Return the appointment' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiBearerAuth()
  async getAppointmentById(@Param('id') id: string, @Request() req) {
    try {
      const clinicId = req.clinicContext?.clinicId;
      return await this.appointmentService.getAppointmentById(id, clinicId);
    } catch (error) {
      this.logger.error(`Failed to get appointment ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':id')
  @ClinicRoute()
  @ApiOperation({
    summary: 'Update an appointment',
    description: 'Update an existing appointment\'s details'
  })
  @ApiBody({ type: UpdateAppointmentDto })
  @ApiResponse({ status: 200, description: 'Appointment updated successfully' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiBearerAuth()
  async updateAppointment(
    @Param('id') id: string,
    @Body() updateData: UpdateAppointmentDto,
    @Request() req
  ) {
    try {
      const clinicId = req.clinicContext?.clinicId;
      return await this.appointmentService.updateAppointment(id, updateData, clinicId);
    } catch (error) {
      this.logger.error(`Failed to update appointment ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':id')
  @ClinicRoute()
  @ApiOperation({
    summary: 'Cancel an appointment',
    description: 'Cancel an existing appointment'
  })
  @ApiResponse({ status: 200, description: 'Appointment cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiBearerAuth()
  async cancelAppointment(@Param('id') id: string, @Request() req) {
    try {
      const clinicId = req.clinicContext?.clinicId;
      return await this.appointmentService.cancelAppointment(id, clinicId);
    } catch (error) {
      this.logger.error(`Failed to cancel appointment ${id}: ${error.message}`, error.stack);
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
