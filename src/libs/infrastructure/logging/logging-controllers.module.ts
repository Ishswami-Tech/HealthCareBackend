import { Module, forwardRef } from '@nestjs/common';
import { LoggingController } from './logging.controller';
import { LoggingModule } from './logging.module';

/**
 * LoggingControllersModule
 *
 * Separate module for LoggingController to avoid duplicate controller registration.
 * LoggingModule is @Global() and imported in multiple places, which would cause
 * controllers to be registered multiple times if they were in the global module.
 *
 * This module should ONLY be imported in AppModule (root module).
 * LoggingController is publicly accessible (no authentication required).
 */
@Module({
  imports: [
    forwardRef(() => LoggingModule), // Import services from LoggingModule
  ],
  controllers: [LoggingController],
})
export class LoggingControllersModule {}
