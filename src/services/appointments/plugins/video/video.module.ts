import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { EventsModule } from '@infrastructure/events';
import { VideoService } from './video.service';
import { JitsiVideoService } from './jitsi-video.service';
import { VideoConsultationTracker } from './video-consultation-tracker.service';
import { ClinicVideoPlugin } from './clinic-video.plugin';

@Module({
  imports: [
    EventEmitterModule, // Required for @OnEvent decorators
    forwardRef(() => EventsModule), // Central event system
    CacheModule,
    LoggingModule,
    SocketModule,
  ],
  providers: [VideoService, JitsiVideoService, VideoConsultationTracker, ClinicVideoPlugin],
  exports: [VideoService, JitsiVideoService, VideoConsultationTracker, ClinicVideoPlugin],
})
export class VideoModule {}
