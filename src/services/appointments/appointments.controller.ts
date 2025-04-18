import { Controller, Get, Post, Put, Delete, Body, Param, Query, Logger } from '@nestjs/common';
import { AppointmentService } from './appointments.service';


@Controller('api/appointments')
export class AppointmentController {
  private readonly logger = new Logger(AppointmentController.name);

  constructor(
    private readonly appointmentService: AppointmentService,
  ) {}

  @Post()
  async createAppointment(@Body() appointmentData: {
    userId: string;
    doctorId: string;
    locationId: string;
    date: string;
    time: string;
    duration: number;
    type: string;
    notes?: string;
  }) {
    try {
      return await this.appointmentService.createAppointment(appointmentData);
    } catch (error) {
      this.logger.error(`Failed to create appointment: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
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
  async getAppointmentById(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.appointmentService.getAppointmentById(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to get appointment ${appointmentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':appointmentId')
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
  async cancelAppointment(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.appointmentService.cancelAppointment(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to cancel appointment ${appointmentId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('doctor/:doctorId/availability')
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