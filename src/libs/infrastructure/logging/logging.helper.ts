/**
 * Safe Logging Helper
 *
 * Provides a safe way to log messages that handles cases where LoggingService
 * might not be available (e.g., during initialization or circular dependencies).
 *
 * @example
 * ```typescript
 * import { safeLog } from '@infrastructure/logging/logging.helper';
 *
 * // Safe logging that won't throw if LoggingService is undefined
 * safeLog(
 *   loggingService,
 *   LogType.SYSTEM,
 *   LogLevel.INFO,
 *   'Message',
 *   'Context',
 *   { metadata: 'value' }
 * );
 * ```
 */

import { LogType, LogLevel } from '@core/types';
import type { LoggingService } from './logging.service';

/**
 * Safely log a message if LoggingService is available
 * @param loggingService - The LoggingService instance (may be undefined)
 * @param type - Log type
 * @param level - Log level
 * @param message - Log message
 * @param context - Log context
 * @param metadata - Optional metadata
 */
export function safeLog(
  loggingService: LoggingService | undefined,
  type: LogType,
  level: LogLevel,
  message: string,
  context: string,
  metadata: Record<string, unknown> = {}
): void {
  if (loggingService && typeof loggingService.log === 'function') {
    try {
      void loggingService.log(type, level, message, context, metadata);
    } catch (error) {
      // Fallback to console if logging fails
      console.warn(`[${context}] ${message}`, metadata);
      console.error('LoggingService.log failed:', error);
    }
  } else {
    // Fallback to console when LoggingService is not available
    const levelPrefix = level.toUpperCase().padEnd(5);
    console.warn(`[${levelPrefix}] [${context}] ${message}`, metadata);
  }
}

/**
 * Safely log an error if LoggingService is available
 * @param loggingService - The LoggingService instance (may be undefined)
 * @param error - The error to log
 * @param context - Log context
 * @param metadata - Optional metadata
 */
export function safeLogError(
  loggingService: LoggingService | undefined,
  error: unknown,
  context: string,
  metadata: Record<string, unknown> = {}
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  safeLog(loggingService, LogType.ERROR, LogLevel.ERROR, errorMessage, context, {
    ...metadata,
    ...(errorStack && { stack: errorStack }),
  });
}
