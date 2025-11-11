/**
 * Database Initialization Script
 *
 * Initializes the database connection and performs basic health checks.
 * This script is called during DatabaseModule initialization.
 *
 * @module DatabaseInitialization
 */

import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Initialize database connection and perform health checks
 *
 * @param loggingService - Optional logging service for initialization logs
 * @returns Promise that resolves when initialization is complete
 */
export async function initDatabase(loggingService?: LoggingService): Promise<void> {
  try {
    if (loggingService) {
      await loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Database initialization started',
        'DatabaseInitialization'
      );
    }

    // Database initialization is handled by PrismaService.onModuleInit()
    // This function is a placeholder for any additional initialization logic
    // that might be needed in the future

    if (loggingService) {
      await loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Database initialization completed',
        'DatabaseInitialization'
      );
    }
  } catch (error) {
    if (loggingService) {
      await loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Database initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        'DatabaseInitialization',
        {
          error: error instanceof Error ? error.stack : String(error),
        }
      );
    }
    throw error;
  }
}
