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

export * from '@communication/messaging/email/email.module';
export * from '@communication/messaging/email/email.service';
export * from '@communication/messaging/email/email-templates.service';
export * from '@communication/messaging/email/email-queue.service';
export * from '@communication/messaging/email/ses-email.service';
