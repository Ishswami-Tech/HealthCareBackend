import { Module } from "@nestjs/common";
import { QrService } from "./qr.service";
import { LocationQrService } from "./location-qr.service";

@Module({
  imports: [],
  providers: [QrService, LocationQrService],
  exports: [QrService, LocationQrService],
})
export class QrModule {}
