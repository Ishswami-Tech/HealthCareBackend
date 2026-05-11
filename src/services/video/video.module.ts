/**
 * Video Module
 * @class VideoModule
 * @description Standalone video service module
 * One backend video service with a swappable provider abstraction.
 */

import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
// TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
import { ConfigModule } from '@config/config.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database/database.module'; // Direct import avoids TDZ circular dep
import { HttpModule } from '@infrastructure/http';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { GuardsModule } from '@core/guards/guards.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { ErrorsModule } from '@core/errors/errors.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { CommunicationModule } from '@communication/communication.module';
import { QueueModule } from '@queue/src/queue.module';
import { StorageModule } from '@infrastructure/storage';
import { EHRModule } from '@services/ehr/ehr.module';
import { BillingModule } from '@services/billing/billing.module';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';
// Video providers
import { VideoProviderFactory } from './providers/video-provider.factory';
import { CloudflareRealtimeProvider } from './providers/cloudflare-realtime.provider';
import { DailyVideoProvider } from './providers/daily-video.provider';
import { GoogleMeetProvider } from './providers/google-meet.provider';
// New feature services
import { VideoChatService } from './services/video-chat.service';
import { VideoWaitingRoomService } from './services/video-waiting-room.service';
import { VideoMedicalNotesService } from './services/video-medical-notes.service';
import { VideoAnnotationService } from './services/video-annotation.service';
import { VideoTranscriptionService } from './services/video-transcription.service';
import { VideoQualityService } from './services/video-quality.service';
import { VideoVirtualBackgroundService } from './services/video-virtual-background.service';
import { DailyHealthSignalService } from './services/daily-health-signal.service';
import { DailyWebhookController } from './webhooks/daily-webhook.controller';
@Module({
  imports: [
    ConfigModule,
    HttpModule, // Centralized HTTP service for provider API calls
    // TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    DatabaseModule, // Required for database operations
    CommunicationModule, // Required for CommunicationHealthIndicator
    SocketModule,
    GuardsModule,
    RbacModule,
    ErrorsModule, // Error handling
    RateLimitModule, // Rate limiting
    QueueModule, // Queue processing for recording processing, transcoding, analytics
    StorageModule, // File storage for virtual backgrounds and other assets
    forwardRef(() => EHRModule), // EHR integration for medical notes and transcriptions
    forwardRef(() => BillingModule),
  ],
  controllers: [VideoController, DailyWebhookController],
  providers: [
    // Providers must be listed BEFORE VideoProviderFactory (which depends on them)
    CloudflareRealtimeProvider,
    DailyVideoProvider,
    GoogleMeetProvider,
    // Provider factory (current runtime: Cloudflare primary, Daily/Google Meet fallback)
    VideoProviderFactory,
    // Single consolidated video service
    VideoService,
    // Other services
    VideoConsultationTracker,
    // New feature services
    VideoChatService,
    VideoWaitingRoomService,
    VideoMedicalNotesService,
    VideoAnnotationService,
    VideoTranscriptionService,
    VideoQualityService,
    VideoVirtualBackgroundService,
    DailyHealthSignalService,
  ],
  exports: [
    VideoService,
    VideoConsultationTracker,
    VideoChatService,
    VideoWaitingRoomService,
    VideoMedicalNotesService,
    VideoAnnotationService,
    VideoTranscriptionService,
    VideoQualityService,
    VideoVirtualBackgroundService,
    DailyHealthSignalService,
  ],
})
export class VideoModule {}
