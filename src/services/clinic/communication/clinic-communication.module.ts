/**
 * Clinic Communication Module
 * ===========================
 * Module for managing clinic communication configurations
 *
 * @module ClinicCommunicationModule
 * @description Clinic communication configuration management module
 */

import { Module, forwardRef } from '@nestjs/common';
import { ClinicCommunicationController } from './clinic-communication.controller';
import { CommunicationConfigModule } from '@communication/config/communication-config.module';
import { LoggingModule } from '@infrastructure/logging/logging.module';

@Module({
  imports: [forwardRef(() => CommunicationConfigModule), forwardRef(() => LoggingModule)],
  controllers: [ClinicCommunicationController],
  exports: [],
})
export class ClinicCommunicationModule {}
