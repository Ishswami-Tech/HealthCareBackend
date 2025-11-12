/**
 * Communication module exports
 *
 * This module provides comprehensive communication services including:
 * - Unified CommunicationService (single entry point for all channels)
 * - Real-time WebSocket communication
 * - Email services (SMTP, SES, templates)
 * - WhatsApp Business API integration
 * - Push notifications (Firebase, SNS)
 * - Chat backup services
 * - Event-driven communication listeners
 *
 * @module Communication
 */

// Unified Communication Service (primary entry point)
export * from './communication.service';
export { CommunicationModule } from './communication.module';

// Channel exports (for direct access if needed)
export * from '@communication/channels/socket';
export * from '@communication/channels/push';
export * from '@communication/channels/email';
export * from '@communication/channels/whatsapp';
export * from '@communication/channels/chat';

// Listeners exports (event-driven communication)
export * from './listeners';

// Notification exports (legacy REST API - use CommunicationService instead)
export * from '../../services/notification/notification.module';
