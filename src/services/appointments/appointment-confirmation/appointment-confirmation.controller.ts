import { Controller, Get, Post, Body, Param, Logger, UseGuards, Request } from '@nestjs/common';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { RolesGuard } from 'src/libs/core/guards/roles.guard';
import { ClinicGuard } from 'src/libs/core/guards/clinic.guard';
import { PermissionGuard } from 'src/libs/core/guards/permission.guard';
import { UseInterceptors } from '@nestjs/common';
import { VerifyAppointmentQRDto, CompleteAppointmentDto } from '../appointment.dto';
import { JwtAuthGuard } from 'src/libs/core/guards/jwt-auth.guard';
import { Permission } from 'src/libs/infrastructure/permissions';

@ApiTags('Appointment Confirmation')
@Controller('api/appointments/confirmation')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, PermissionGuard)
@ApiBearerAuth()
@ApiSecurity('session-id')
export class AppointmentConfirmationController {
  private readonly logger = new Logger(AppointmentConfirmationController.name);

  constructor(
    private readonly confirmationService: AppointmentConfirmationService,
  ) {}

  @Get(':appointmentId/qr')
  @Permission('manage_appointments', 'appointment', 'appointmentId')
  async generateConfirmationQR(@Param('appointmentId') appointmentId: string) {
    try {
      return {
        qrCode: await this.confirmationService.generateConfirmationQR(appointmentId),
      };
    } catch (error) {
      this.logger.error(`Failed to generate QR code: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('verify')
  @ApiBody({ type: VerifyAppointmentQRDto })
  @Permission('manage_appointments', 'appointment', 'appointmentId')
  async verifyAppointmentQR(
    @Body() body: VerifyAppointmentQRDto,
  ) {
    try {
      return await this.confirmationService.verifyAppointmentQR(
        body.qrData,
        body.locationId,
      );
    } catch (error) {
      this.logger.error(`Failed to verify QR code: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post(':appointmentId/complete')
  @ApiBody({ type: CompleteAppointmentDto })
  @Permission('manage_appointments', 'appointment', 'appointmentId')
  async markAppointmentCompleted(
    @Param('appointmentId') appointmentId: string,
    @Body() body: CompleteAppointmentDto,
  ) {
    try {
      return await this.confirmationService.markAppointmentCompleted(
        appointmentId,
        body.doctorId,
      );
    } catch (error) {
      this.logger.error(`Failed to mark appointment as completed: ${error.message}`, error.stack);
      throw error;
    }
  }
} 