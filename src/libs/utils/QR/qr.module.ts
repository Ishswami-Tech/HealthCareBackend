import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Internal imports - Infrastructure
import { LoggingModule } from '@infrastructure/logging';

import { QrService } from './qr.service';
import { LocationQrService } from './location-qr.service';

@Module({
  imports: [LoggingModule, forwardRef(() => ConfigModule)],
  providers: [QrService, LocationQrService],
  exports: [QrService, LocationQrService],
})
export class QrModule {}
