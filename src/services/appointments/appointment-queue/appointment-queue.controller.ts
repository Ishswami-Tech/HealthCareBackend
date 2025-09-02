import { Controller, Get, Post, Param, Body, Logger, UseGuards } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/libs/core/guards/jwt-auth.guard';
import { RolesGuard } from 'src/libs/core/guards/roles.guard';
import { ClinicGuard } from 'src/libs/core/guards/clinic.guard';
import { PermissionGuard } from 'src/libs/core/guards/permission.guard';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from 'src/libs/utils/interceptors/tenant-context.interceptor';
import { StartConsultationDto } from '../appointment.dto';
import { Permission } from 'src/libs/infrastructure/permissions';

@ApiTags('Appointment Queue')
@Controller('api/appointments/queue')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, PermissionGuard)
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
  @Permission('manage_appointments', 'appointment', 'appointmentId')
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
  @Permission('manage_appointments', 'appointment', 'appointmentId')
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
  @ApiBody({ type: StartConsultationDto })
  @Permission('manage_appointments', 'appointment', 'appointmentId')
  async startConsultation(
    @Param('appointmentId') appointmentId: string,
    @Body() body: StartConsultationDto,
  ) {
    try {
      return await this.queueService.startConsultation(appointmentId, body.doctorId);
    } catch (error) {
      this.logger.error(`Failed to start consultation: ${error.message}`, error.stack);
      throw error;
    }
  }
} 