/**
 * Storage Module
 * ==============
 * Module for static asset storage (S3/CDN integration)
 *
 * @module StorageModule
 * @description Storage infrastructure module
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { LoggingModule } from '@infrastructure/logging';
import { S3StorageService } from './s3-storage.service';
import { StaticAssetService } from './static-asset.service';

@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [S3StorageService, StaticAssetService],
  exports: [S3StorageService, StaticAssetService],
})
export class StorageModule {}
