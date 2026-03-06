import { Injectable, Inject, forwardRef } from '@nestjs/common';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import type {
  AppointmentTemplateData,
  PrescriptionTemplateData,
  PaymentTemplateData,
  PasswordResetTemplateData,
  AccountVerificationTemplateData,
} from '@core/types/communication.types';
import {
  generateAppointmentReminderTemplate,
  generatePrescriptionReadyTemplate,
  generatePaymentConfirmationTemplate,
  generatePasswordResetTemplate,
  generateAccountVerificationTemplate,
} from '@communication/templates/emailTemplates';

/**
 * Email templates service for generating HTML email templates
 *
 * @class EmailTemplatesService
 */
@Injectable()
export class EmailTemplatesService {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Generates appointment reminder email template
   * @param data - Appointment template data
   * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
   * @returns HTML email template
   */
  generateAppointmentReminderTemplate(
    data: AppointmentTemplateData,
    unsubscribeUrl?: string
  ): string {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Generating appointment reminder template',
      'EmailTemplatesService',
      {
        patientName: data.patientName,
        doctorName: data.doctorName,
        appointmentDate: data.appointmentDate,
      }
    );

    return generateAppointmentReminderTemplate(data, unsubscribeUrl);
  }

  /**
   * Generates prescription ready email template
   * @param data - Prescription template data
   * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
   * @returns HTML email template
   */
  generatePrescriptionReadyTemplate(
    data: PrescriptionTemplateData,
    unsubscribeUrl?: string
  ): string {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Generating prescription ready template',
      'EmailTemplatesService',
      {
        patientName: data.patientName,
        prescriptionId: data.prescriptionId,
        medicationCount: data.medications.length,
      }
    );

    return generatePrescriptionReadyTemplate(data, unsubscribeUrl);
  }

  /**
   * Generates payment confirmation email template
   * @param data - Payment template data
   * @param unsubscribeUrl - Optional unsubscribe URL (will be added automatically if not provided)
   * @returns HTML email template
   */
  generatePaymentConfirmationTemplate(data: PaymentTemplateData, unsubscribeUrl?: string): string {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Generating payment confirmation template',
      'EmailTemplatesService',
      {
        patientName: data.patientName,
        amount: data.amount,
        transactionId: data.transactionId,
      }
    );

    return generatePaymentConfirmationTemplate(data, unsubscribeUrl);
  }

  /**
   * Generates password reset email template
   * @param data - Password reset template data
   * @returns HTML email template
   */
  generatePasswordResetTemplate(data: PasswordResetTemplateData): string {
    return generatePasswordResetTemplate(data);
  }

  /**
   * Generates account verification email template
   * @param data - Account verification template data
   * @returns HTML email template
   */
  generateAccountVerificationTemplate(data: AccountVerificationTemplateData): string {
    return generateAccountVerificationTemplate(data);
  }
}
