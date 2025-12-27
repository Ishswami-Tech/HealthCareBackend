/**
 * Communication Config Module
 * ============================
 * Module for multi-tenant communication configuration
 *
 * @module CommunicationConfigModule
 * @description Communication configuration module
 */

import { Module, forwardRef } from '@nestjs/common';
// Use direct import to avoid circular dependency with barrel exports
import { ConfigModule } from '@config/config.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
// CacheModule is @Global() - no need to import, CacheService is available globally
// Use direct import and forwardRef to avoid TDZ issues
import { LoggingModule } from '@infrastructure/logging/logging.module';
import { EmailServicesModule } from '@communication/adapters/email/email-services.module';
import { CredentialEncryptionService } from './credential-encryption.service';
import { CommunicationConfigService } from './communication-config.service';
import { ClinicTemplateService } from '../services/clinic-template.service';

@Module({
  imports: [
    forwardRef(() => ConfigModule),
    forwardRef(() => DatabaseModule),
    forwardRef(() => LoggingModule),
    forwardRef(() => EmailServicesModule),
  ],
  providers: [CredentialEncryptionService, CommunicationConfigService, ClinicTemplateService],
  exports: [CredentialEncryptionService, CommunicationConfigService, ClinicTemplateService],
})
export class CommunicationConfigModule {}
