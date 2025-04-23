import { Module } from '@nestjs/common';
import { QrService } from './qr.service';
import { LocationQrService } from './location-qr.service';
import { PrismaModule } from '../database/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [QrService, LocationQrService],
  exports: [QrService, LocationQrService],
})
export class QrModule {} 