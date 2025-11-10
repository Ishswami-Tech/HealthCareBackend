import { Module } from '@nestjs/common';
import { EmailModule } from '@communication/messaging/email/email.module';
import { WhatsAppModule } from '@communication/messaging/whatsapp/whatsapp.module';
import { PushModule } from '@communication/messaging/push/push.module';
import { SocketModule } from '@communication/socket/socket.module';

/**
 * Unified Communication Module
 *
 * Aggregates all communication services into a single module for easier import.
 * Provides:
 * - Email services (SMTP, SES, templates, queue management)
 * - WhatsApp Business API integration
 * - Push notifications (Firebase, SNS)
 * - Real-time WebSocket communication
 *
 * @module CommunicationModule
 * @description Centralized module for all communication services
 *
 * @example
 * ```typescript
 * // In your module
 * @Module({
 *   imports: [CommunicationModule],
 * })
 * export class AppointmentsModule {}
 * ```
 */
@Module({
  imports: [EmailModule, WhatsAppModule, PushModule, SocketModule],
  exports: [EmailModule, WhatsAppModule, PushModule, SocketModule],
})
export class CommunicationModule {}

