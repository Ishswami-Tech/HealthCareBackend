import { Module } from '@nestjs/common';

// Internal imports - Infrastructure
import { LoggingModule } from '@infrastructure/logging';

import { QrService } from './qr.service';
import { LocationQrService } from './location-qr.service';

@Module({
  imports: [LoggingModule],
  providers: [QrService, LocationQrService],
  exports: [QrService, LocationQrService],
})
export class QrModule {}
