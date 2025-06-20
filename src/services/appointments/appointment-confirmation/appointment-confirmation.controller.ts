import { Controller, Get, Post, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../../libs/guards/roles.guard';
import { ClinicGuard } from '../../../libs/guards/clinic.guard';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from '../../../shared/interceptors/tenant-context.interceptor';
import { VerifyAppointmentQRDto, CompleteAppointmentDto } from '../appointment.dto';

@ApiTags('Appointment Confirmation')
@Controller('api/appointments/confirmation')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(TenantContextInterceptor)
@ApiBearerAuth()
@ApiSecurity('session-id')
export class AppointmentConfirmationController {
  private readonly logger = new Logger(AppointmentConfirmationController.name);

  constructor(
    private readonly confirmationService: AppointmentConfirmationService,
  ) {}

  @Get(':appointmentId/qr')
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