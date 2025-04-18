import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { AppointmentConfirmationService } from './appointment-confirmation.service';

@Controller('api/appointments/confirmation')
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
  async verifyAppointmentQR(
    @Body() data: { qrData: string; locationId: string },
  ) {
    try {
      return await this.confirmationService.verifyAppointmentQR(
        data.qrData,
        data.locationId,
      );
    } catch (error) {
      this.logger.error(`Failed to verify QR code: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post(':appointmentId/complete')
  async markAppointmentCompleted(
    @Param('appointmentId') appointmentId: string,
    @Body() data: { doctorId: string },
  ) {
    try {
      return await this.confirmationService.markAppointmentCompleted(
        appointmentId,
        data.doctorId,
      );
    } catch (error) {
      this.logger.error(`Failed to mark appointment as completed: ${error.message}`, error.stack);
      throw error;
    }
  }
} 