/**
 * Communication Config Module
 * ============================
 * Module for multi-tenant communication configuration
 *
 * @module CommunicationConfigModule
 * @description Communication configuration module
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CommunicationConfigService } from './communication-config.service';

@Module({
  imports: [ConfigModule, DatabaseModule, CacheModule, LoggingModule],
  providers: [CredentialEncryptionService, CommunicationConfigService],
  exports: [CredentialEncryptionService, CommunicationConfigService],
})
export class CommunicationConfigModule {}
