import { Controller, Get, Post, Param, Body, Logger, UseGuards } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../../libs/guards/roles.guard';
import { ClinicGuard } from '../../../libs/guards/clinic.guard';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from '../../../shared/interceptors/tenant-context.interceptor';

@ApiTags('Appointment Queue')
@Controller('api/appointments/queue')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(TenantContextInterceptor)
@ApiBearerAuth()
@ApiSecurity('session-id')
export class AppointmentQueueController {
  private readonly logger = new Logger(AppointmentQueueController.name);

  constructor(
    private readonly queueService: AppointmentQueueService,
  ) {}

  @Get('doctor/:doctorId')
  @ApiOperation({
    summary: 'Get doctor queue',
    description: 'Get current queue for a specific doctor'
  })
  async getDoctorQueue(
    @Param('doctorId') doctorId: string,
    @Body('date') date: string,
  ) {
    try {
      return await this.queueService.getDoctorQueue(doctorId, date);
    } catch (error) {
      this.logger.error(`Failed to get doctor queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('position/:appointmentId')
  @ApiOperation({
    summary: 'Get patient queue position',
    description: 'Get patient\'s current position in the queue'
  })
  async getPatientQueuePosition(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.queueService.getPatientQueuePosition(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to get queue position: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('confirm/:appointmentId')
  @ApiOperation({
    summary: 'Confirm appointment',
    description: 'Move appointment from CHECKED_IN to CONFIRMED status'
  })
  async confirmAppointment(@Param('appointmentId') appointmentId: string) {
    try {
      return await this.queueService.confirmAppointment(appointmentId);
    } catch (error) {
      this.logger.error(`Failed to confirm appointment: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('start/:appointmentId')
  @ApiOperation({
    summary: 'Start consultation',
    description: 'Move appointment from CONFIRMED to IN_PROGRESS status'
  })
  async startConsultation(
    @Param('appointmentId') appointmentId: string,
    @Body('doctorId') doctorId: string,
  ) {
    try {
      return await this.queueService.startConsultation(appointmentId, doctorId);
    } catch (error) {
      this.logger.error(`Failed to start consultation: ${error.message}`, error.stack);
      throw error;
    }
  }
} 