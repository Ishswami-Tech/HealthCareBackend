import { Injectable, Inject, forwardRef } from '@nestjs/common';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import {
  generateAppointmentReminderTemplate,
  generatePrescriptionReadyTemplate,
  generatePaymentConfirmationTemplate,
  generatePasswordResetTemplate,
  generateAccountVerificationTemplate,
} from '@communication/templates/emailTemplates';

/**
 * Base email template data interface
 * @interface EmailTemplateData
 */
export interface EmailTemplateData {
  /** Patient name for personalization */
  readonly patientName: string;
  /** Clinic name for branding */
  readonly clinicName?: string;
  /** Additional template-specific data */
  readonly [key: string]: string | number | boolean | undefined | readonly string[];
}

/**
 * Appointment reminder template data
 * @interface AppointmentTemplateData
 */
export interface AppointmentTemplateData extends EmailTemplateData {
  /** Doctor name */
  readonly doctorName: string;
  /** Appointment date */
  readonly appointmentDate: string;
  /** Appointment time */
  readonly appointmentTime: string;
  /** Appointment location */
  readonly location: string;
  /** Optional appointment ID */
  readonly appointmentId?: string;
  /** Optional reschedule URL */
  readonly rescheduleUrl?: string;
  /** Optional cancel URL */
  readonly cancelUrl?: string;
}

/**
 * Prescription ready template data
 * @interface PrescriptionTemplateData
 */
export interface PrescriptionTemplateData extends EmailTemplateData {
  /** Doctor name who prescribed */
  readonly doctorName: string;
  /** Prescription ID */
  readonly prescriptionId: string;
  /** List of prescribed medications */
  readonly medications: readonly string[];
  /** Optional pickup instructions */
  readonly pickupInstructions?: string;
  /** Optional pharmacy name */
  readonly pharmacyName?: string;
  /** Optional pharmacy address */
  readonly pharmacyAddress?: string;
}

/**
 * Payment confirmation template data
 * @interface PaymentTemplateData
 */
export interface PaymentTemplateData extends EmailTemplateData {
  /** Payment amount */
  readonly amount: number;
  /** Currency code */
  readonly currency: string;
  /** Transaction ID */
  readonly transactionId: string;
  /** Payment date */
  readonly paymentDate: string;
  /** Service description */
  readonly serviceDescription: string;
  /** Optional receipt URL */
  readonly receiptUrl?: string;
}

/**
 * Password reset template data
 * @interface PasswordResetTemplateData
 */
export interface PasswordResetTemplateData extends EmailTemplateData {
  /** Password reset URL */
  readonly resetUrl: string;
  /** Expiry time description */
  readonly expiryTime: string;
}

/**
 * Account verification template data
 * @interface AccountVerificationTemplateData
 */
export interface AccountVerificationTemplateData extends EmailTemplateData {
  /** Verification URL */
  readonly verificationUrl: string;
  /** Verification code */
  readonly verificationCode: string;
}

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
