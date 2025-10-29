import { Injectable, Logger } from "@nestjs/common";

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
  readonly [key: string]: unknown;
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
  private readonly logger = new Logger(EmailTemplatesService.name);

  /**
   * Generates appointment reminder email template
   * @param data - Appointment template data
   * @returns HTML email template
   */
  generateAppointmentReminderTemplate(data: AppointmentTemplateData): string {
    this.logger.log("Generating appointment reminder template", {
      patientName: data.patientName,
      doctorName: data.doctorName,
      appointmentDate: data.appointmentDate,
    });

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Appointment Reminder</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Appointment Reminder</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your healthcare appointment is coming up</p>
        </div>

        <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
          <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

          <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
            This is a friendly reminder about your upcoming appointment with our healthcare team.
          </p>

          <div style="background: #f8f9fc; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
            <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Appointment Details</h3>
            <div style="display: grid; gap: 12px;">
              <div><strong style="color: #2c3e50;">Doctor:</strong> <span style="color: #555;">${data.doctorName}</span></div>
              <div><strong style="color: #2c3e50;">Date:</strong> <span style="color: #555;">${data.appointmentDate}</span></div>
              <div><strong style="color: #2c3e50;">Time:</strong> <span style="color: #555;">${data.appointmentTime}</span></div>
              <div><strong style="color: #2c3e50;">Location:</strong> <span style="color: #555;">${data.location}</span></div>
              ${data.appointmentId ? `<div><strong style="color: #2c3e50;">Appointment ID:</strong> <span style="color: #555;">${data.appointmentId}</span></div>` : ""}
            </div>
          </div>

          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">Important Reminders</h4>
            <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
              <li style="margin-bottom: 8px;">Please arrive 15 minutes early for check-in</li>
              <li style="margin-bottom: 8px;">Bring a valid photo ID and insurance card</li>
              <li style="margin-bottom: 8px;">Bring a list of current medications</li>
              <li>If you need to reschedule, please contact us as soon as possible</li>
            </ul>
          </div>

          ${
            data.rescheduleUrl || data.cancelUrl
              ? `
          <div style="text-align: center; margin: 40px 0;">
            ${data.rescheduleUrl ? `<a href="${data.rescheduleUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 0 10px 10px 0; font-weight: bold;">Reschedule Appointment</a>` : ""}
            ${data.cancelUrl ? `<a href="${data.cancelUrl}" style="display: inline-block; background: #f44336; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin: 0 10px 10px 0; font-weight: bold;">Cancel Appointment</a>` : ""}
          </div>
          `
              : ""
          }

          <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
            If you have any questions or concerns, please don't hesitate to contact us. We look forward to seeing you!
          </p>
        </div>

        <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || "Healthcare Team"}</p>
          <p style="margin: 0; font-size: 12px; color: #888;">This is an automated reminder. Please do not reply to this email.</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generates prescription ready email template
   * @param data - Prescription template data
   * @returns HTML email template
   */
  generatePrescriptionReadyTemplate(data: PrescriptionTemplateData): string {
    this.logger.log("Generating prescription ready template", {
      patientName: data.patientName,
      prescriptionId: data.prescriptionId,
      medicationCount: data.medications.length,
    });

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Prescription Ready</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #ff7e5f 0%, #feb47b 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Prescription Ready</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Your prescription is ready for pickup</p>
        </div>

        <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
          <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

          <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
            Great news! Your prescription is ready for pickup at ${data.pharmacyName || "our pharmacy"}.
          </p>

          <div style="background: #fff3e0; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #FF9800;">
            <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Prescription Details</h3>
            <div style="margin-bottom: 15px;">
              <strong style="color: #2c3e50;">Prescription ID:</strong> <span style="color: #555;">${data.prescriptionId}</span>
            </div>
            <div style="margin-bottom: 20px;">
              <strong style="color: #2c3e50;">Prescribed by:</strong> <span style="color: #555;">${data.doctorName}</span>
            </div>

            <div style="margin-bottom: 10px;">
              <strong style="color: #2c3e50;">Medications:</strong>
            </div>
            <ul style="margin: 5px 0 0 20px; padding: 0; color: #555;">
              ${data.medications.map((medication) => `<li style="margin-bottom: 5px; padding: 5px 0; border-bottom: 1px solid #eee;">${medication}</li>`).join("")}
            </ul>
          </div>

          ${
            data.pharmacyName || data.pharmacyAddress
              ? `
          <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
            <h4 style="margin: 0 0 15px 0; color: #2e7d32;">Pickup Location</h4>
            ${data.pharmacyName ? `<div style="margin-bottom: 8px;"><strong>Pharmacy:</strong> ${data.pharmacyName}</div>` : ""}
            ${data.pharmacyAddress ? `<div><strong>Address:</strong> ${data.pharmacyAddress}</div>` : ""}
          </div>
          `
              : ""
          }

          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">Pickup Requirements</h4>
            <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
              <li style="margin-bottom: 8px;">Please bring a valid photo ID</li>
              <li style="margin-bottom: 8px;">Insurance card (if applicable)</li>
              <li>Payment method for any copay or deductible</li>
            </ul>
            ${data.pickupInstructions ? `<p style="margin: 15px 0 0 0; color: #1976d2;"><strong>Special Instructions:</strong> ${data.pickupInstructions}</p>` : ""}
          </div>

          <div style="text-align: center; margin: 40px 0;">
            <div style="background: #f44336; color: white; padding: 15px; border-radius: 5px; display: inline-block;">
              <strong>⏰ Please pickup within 10 days</strong>
            </div>
          </div>

          <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
            If you have any questions about your medications or the pickup process, please don't hesitate to contact us.
          </p>
        </div>

        <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #FF9800; font-weight: bold;">${data.clinicName || "Healthcare Pharmacy Team"}</p>
          <p style="margin: 0; font-size: 12px; color: #888;">This is an automated notification. Please do not reply to this email.</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generates payment confirmation email template
   * @param data - Payment template data
   * @returns HTML email template
   */
  generatePaymentConfirmationTemplate(data: PaymentTemplateData): string {
    this.logger.log("Generating payment confirmation template", {
      patientName: data.patientName,
      amount: data.amount,
      transactionId: data.transactionId,
    });

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Confirmation</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Payment Confirmed</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Thank you for your payment</p>
        </div>

        <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
          <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

          <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
            We have successfully received your payment. Thank you for choosing our healthcare services.
          </p>

          <div style="background: #e8f5e9; padding: 25px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #4CAF50;">
            <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px;">Payment Details</h3>
            <div style="display: grid; gap: 12px;">
              <div><strong style="color: #2c3e50;">Amount:</strong> <span style="color: #555; font-size: 18px; font-weight: bold;">${data.currency} ${data.amount.toFixed(2)}</span></div>
              <div><strong style="color: #2c3e50;">Transaction ID:</strong> <span style="color: #555;">${data.transactionId}</span></div>
              <div><strong style="color: #2c3e50;">Payment Date:</strong> <span style="color: #555;">${data.paymentDate}</span></div>
              <div><strong style="color: #2c3e50;">Service:</strong> <span style="color: #555;">${data.serviceDescription}</span></div>
            </div>
          </div>

          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
            <h4 style="margin: 0 0 10px 0; color: #1976d2;">What's Next?</h4>
            <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
              <li style="margin-bottom: 8px;">You will receive a receipt via email shortly</li>
              <li style="margin-bottom: 8px;">Your appointment is confirmed and scheduled</li>
              <li>If you need to make changes, please contact us</li>
            </ul>
          </div>

          ${
            data.receiptUrl
              ? `
          <div style="text-align: center; margin: 40px 0;">
            <a href="${data.receiptUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Download Receipt</a>
          </div>
          `
              : ""
          }

          <p style="font-size: 16px; color: #555; margin: 30px 0 0 0;">
            If you have any questions about this payment or need assistance, please contact our billing department.
          </p>
        </div>

        <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || "Healthcare Team"}</p>
          <p style="margin: 0; font-size: 12px; color: #888;">This is an automated confirmation. Please do not reply to this email.</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generates password reset email template
   * @param data - Password reset template data
   * @returns HTML email template
   */
  generatePasswordResetTemplate(data: PasswordResetTemplateData): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Password Reset</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Reset your account password</p>
        </div>

        <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
          <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

          <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
            We received a request to reset your password. Click the button below to create a new password.
          </p>

          <div style="text-align: center; margin: 40px 0;">
            <a href="${data.resetUrl}" style="display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Reset Password</a>
          </div>

          <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #ffc107;">
            <h4 style="margin: 0 0 10px 0; color: #856404;">Security Notice</h4>
            <ul style="margin: 0; padding-left: 20px; color: #856404;">
              <li style="margin-bottom: 8px;">This link expires in ${data.expiryTime}</li>
              <li style="margin-bottom: 8px;">If you didn't request this reset, please ignore this email</li>
              <li>For security, this link can only be used once</li>
            </ul>
          </div>

          <p style="font-size: 14px; color: #888; margin: 30px 0 0 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${data.resetUrl}" style="color: #667eea; word-break: break-all;">${data.resetUrl}</a>
          </p>
        </div>

        <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #667eea; font-weight: bold;">${data.clinicName || "Healthcare Team"}</p>
          <p style="margin: 0; font-size: 12px; color: #888;">This is an automated security email. Please do not reply.</p>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Generates account verification email template
   * @param data - Account verification template data
   * @returns HTML email template
   */
  generateAccountVerificationTemplate(
    data: AccountVerificationTemplateData,
  ): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Verification</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); padding: 30px; text-align: center; color: white; border-radius: 10px 10px 0 0;">
          <h1 style="margin: 0; font-size: 28px; font-weight: bold;">Welcome!</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Verify your account to get started</p>
        </div>

        <div style="background: white; padding: 40px 30px; border: 1px solid #e0e0e0; border-top: none;">
          <p style="font-size: 18px; color: #333; margin: 0 0 30px 0;">Dear ${data.patientName},</p>

          <p style="font-size: 16px; color: #555; margin: 0 0 30px 0;">
            Welcome to our healthcare platform! Please verify your email address to activate your account.
          </p>

          <div style="text-align: center; margin: 40px 0;">
            <a href="${data.verificationUrl}" style="display: inline-block; background: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">Verify Account</a>
          </div>

          <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #2196F3;">
            <h4 style="margin: 0 0 15px 0; color: #1976d2;">Verification Code</h4>
            <p style="margin: 0; color: #1976d2;">If the button doesn't work, use this code:</p>
            <div style="background: white; padding: 15px; margin: 10px 0; border-radius: 5px; text-align: center; font-family: monospace; font-size: 24px; font-weight: bold; letter-spacing: 3px; color: #1976d2;">${data.verificationCode}</div>
          </div>

          <p style="font-size: 14px; color: #888; margin: 30px 0 0 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${data.verificationUrl}" style="color: #4CAF50; word-break: break-all;">${data.verificationUrl}</a>
          </p>
        </div>

        <div style="background: #f8f9fc; padding: 25px 30px; text-align: center; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
          <p style="margin: 0 0 10px 0; font-size: 16px; color: #333; font-weight: bold;">Best regards,</p>
          <p style="margin: 0 0 20px 0; font-size: 16px; color: #4CAF50; font-weight: bold;">${data.clinicName || "Healthcare Team"}</p>
          <p style="margin: 0; font-size: 12px; color: #888;">This is an automated verification email. Please do not reply.</p>
        </div>
      </body>
      </html>
    `;
  }
}
