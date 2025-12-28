import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache';
import { EventsModule } from '@infrastructure/events';
import { NotificationPreferenceController } from './notification-preference.controller';
import { NotificationPreferenceService } from './notification-preference.service';
import { CommunicationModule } from '@communication/communication.module';
import { PushModule } from '@communication/channels/push';
import { EmailModule } from '@communication/channels/email';
import { ChatModule } from '@communication/channels/chat';

/**
 * Notification Module
 *
 * Provides REST API endpoints for external notification operations.
 * Uses CommunicationService for unified communication delivery.
 *
 * Features:
 * - REST API endpoints for push, email, and unified notifications
 * - Chat backup endpoints
 * - Statistics and health check endpoints
 * - Topic-based push notifications
 * - Uses unified CommunicationService internally for consistent delivery
 *
 * Use Cases:
 * - External API access (mobile apps, third-party integrations)
 * - Testing and debugging
 * - Monitoring and health checks
 * - Direct channel access when needed (topics, subscriptions)
 *
 * @module NotificationModule
 * @location @services/notification
 */
@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    LoggingModule,
    DatabaseModule,
    CacheModule,
    EventsModule,
    EmailModule,
    PushModule,
    ChatModule, // Chat backup service
    forwardRef(() => CommunicationModule), // Unified communication service
  ],
  controllers: [NotificationPreferenceController],
  providers: [NotificationPreferenceService],
  exports: [NotificationPreferenceService],
})
export class NotificationModule {}
