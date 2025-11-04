/**
 * Messaging services exports
 *
 * Provides comprehensive messaging capabilities:
 * - Email services: SMTP, Mailtrap, AWS SES, templates, queue management
 * - WhatsApp Business API: Template messages, OTPs, appointment reminders
 * - Push notifications: Firebase FCM, AWS SNS, device token management
 * - Chat backup: Firebase Realtime Database integration
 *
 * Architecture:
 * - All services use LoggingService for HIPAA-compliant logging
 * - Optional DatabaseService integration for persistence and audit trails
 * - Follows the same patterns as database infrastructure services
 *
 * @module Messaging
 */

export * from '@communication/messaging/email';
export * from '@communication/messaging/whatsapp';
export * from '@communication/messaging/push';
