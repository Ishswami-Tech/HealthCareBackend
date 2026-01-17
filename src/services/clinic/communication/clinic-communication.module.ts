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
// Import SessionModule - ClinicCommunicationController uses JwtAuthGuard which requires SessionManagementService
import { SessionModule } from '@core/session/session.module';

@Module({
  imports: [
    forwardRef(() => CommunicationConfigModule),
    forwardRef(() => LoggingModule),
    forwardRef(() => SessionModule), // JwtAuthGuard requires SessionManagementService
  ],
  controllers: [ClinicCommunicationController],
  exports: [],
})
export class ClinicCommunicationModule {}
