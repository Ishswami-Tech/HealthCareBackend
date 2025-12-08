import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { EventsModule } from '@infrastructure/events';
import { VideoService } from './video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';
import { ClinicVideoPlugin } from './clinic-video.plugin';
// Video providers (internal - not exported)
import { VideoProviderFactory } from './providers/video-provider.factory';
import { OpenViduVideoProvider } from './providers/openvidu-video.provider';
import { JitsiVideoProvider } from './providers/jitsi-video.provider';

@Module({
  imports: [
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    DatabaseModule, // Required for database operations
    SocketModule,
  ],
  providers: [
    // Single consolidated video service
    VideoService,
    // Video providers (internal - used by VideoService)
    VideoProviderFactory,
    OpenViduVideoProvider, // Primary provider (OpenVidu)
    JitsiVideoProvider, // Fallback provider (Jitsi)
    // Other services
    VideoConsultationTracker,
    ClinicVideoPlugin,
  ],
  exports: [
    // Export single video service
    VideoService,
    // Other services
    VideoConsultationTracker,
    ClinicVideoPlugin,
  ],
})
export class VideoModule {}
