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

export * from '@communication/channels/email/email.module';
export * from '@communication/channels/email/email.service';
export * from '@communication/channels/email/email-templates.service';
export * from '@communication/channels/email/email-queue.service';
export * from '@communication/channels/email/ses-email.service';
