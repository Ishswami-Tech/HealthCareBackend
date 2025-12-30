/**
 * Email services exports
 *
 * Provides email communication capabilities:
 * - EmailService: Primary email sending service (SMTP/Mailtrap)
 * - EmailTemplatesService: Healthcare email template generation
 * - EmailQueueService: Queue management for bulk email operations
 * - SESEmailService: AWS SES integration
 *
 * @module Email
 */

export { EmailModule } from '@communication/channels/email/email.module';
export { EmailService } from '@communication/channels/email/email.service';
export { EmailController } from '@communication/channels/email/email.controller';
export { EmailTemplatesService } from '@communication/channels/email/email-templates.service';
export { EmailQueueService } from '@communication/channels/email/email-queue.service';
export { SESEmailService } from '@communication/channels/email/ses-email.service';
export type {
  AppointmentTemplateData,
  PrescriptionTemplateData,
  PaymentTemplateData,
  AccountVerificationTemplateData,
  PasswordResetTemplateData,
} from '@communication/channels/email/email-templates.service';
