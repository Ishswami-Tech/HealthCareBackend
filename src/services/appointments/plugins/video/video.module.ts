import { Module } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { CacheModule } from "../../../../libs/infrastructure/cache";
import { LoggingModule } from "../../../../libs/infrastructure/logging";
import { SocketModule } from "../../../../libs/communication/socket/socket.module";
import { VideoService } from "./video.service";
import { JitsiVideoService } from "./jitsi-video.service";
import { VideoConsultationTracker } from "./video-consultation-tracker.service";
import { ClinicVideoPlugin } from "./clinic-video.plugin";

@Module({
  imports: [EventEmitterModule, CacheModule, LoggingModule, SocketModule],
  providers: [
    VideoService,
    JitsiVideoService,
    VideoConsultationTracker,
    ClinicVideoPlugin,
  ],
  exports: [
    VideoService,
    JitsiVideoService,
    VideoConsultationTracker,
    ClinicVideoPlugin,
  ],
})
export class VideoModule {}
