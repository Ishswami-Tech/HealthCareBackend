/**
 * Safe Logging Helper
 *
 * Provides a safe way to log messages that handles cases where LoggingService
 * might not be available (e.g., during initialization or circular dependencies).
 *
 * IMPORTANT: This helper is ONLY for bootstrap/initialization scenarios where
 * LoggingService may not be available yet. All normal application code should
 * inject LoggingService directly and use it (per .ai-rules/ coding standards).
 *
 * @example
 * ```typescript
 * import { safeLog } from '@infrastructure/logging/logging.helper';
 *
 * // Safe logging that won't throw if LoggingService is undefined
 * // ONLY use in bootstrap/initialization code, not in normal services
 * safeLog(
 *   loggingService,
 *   LogType.SYSTEM,
 *   LogLevel.INFO,
 *   'Message',
 *   'Context',
 *   { metadata: 'value' }
 * );
 * ```
 *
 * @note Per .ai-rules/ coding standards, all normal application code should use
 * LoggingService directly. This helper is an exception for bootstrap scenarios only.
 */

import { LogType, LogLevel } from '@core/types';
import type { LoggingService } from './logging.service';

/**
 * Safely log a message if LoggingService is available
 *
 * IMPORTANT: This is ONLY for bootstrap/initialization scenarios.
 * Normal services should inject LoggingService directly (per .ai-rules/).
 *
 * @param loggingService - The LoggingService instance (may be undefined)
 * @param type - Log type
 * @param level - Log level
 * @param message - Log message
 * @param context - Log context
 * @param metadata - Optional metadata
 *
 * @note If LoggingService is unavailable, this function silently fails.
 * This is intentional for bootstrap scenarios where logging may not be ready.
 * In normal application code, LoggingService should always be available.
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
    } catch (_error) {
      // Silently fail in bootstrap scenarios - LoggingService may not be fully initialized
      // This is acceptable for bootstrap code only (per .ai-rules/ exception)
      // Normal application code should never reach this catch block
    }
  }
  // If LoggingService is unavailable, silently fail (bootstrap scenario)
  // Normal application code should always have LoggingService available
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
