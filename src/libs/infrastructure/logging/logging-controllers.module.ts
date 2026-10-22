import { Module, forwardRef } from '@nestjs/common';
import { LoggingController } from './logging.controller';
import { LoggingModule } from './logging.module';
import { LoggerUiEnabledGuard } from '@infrastructure/logging/logger-ui-access.guard';

/**
 * LoggingControllersModule
 *
 * Separate module for LoggingController to avoid duplicate controller registration.
 * LoggingModule is @Global() and imported in multiple places, which would cause
 * controllers to be registered multiple times if they were in the global module.
 *
 * This module should ONLY be imported in AppModule (root module).
 * Only /logger/health is public. The log/event viewer and its JSON APIs are SUPER_ADMIN-only
 * and are disabled in production unless LOGGER_UI_ENABLED=true (see LoggerUiEnabledGuard).
 */
@Module({
  imports: [
    forwardRef(() => LoggingModule), // Import services from LoggingModule
  ],
  controllers: [LoggingController],
  providers: [LoggerUiEnabledGuard],
})
export class LoggingControllersModule {}
