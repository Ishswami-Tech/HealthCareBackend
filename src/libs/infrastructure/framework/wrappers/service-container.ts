/**
 * Service Container Wrapper
 *
 * @module ServiceContainer
 * @description Type-safe service retrieval from NestJS dependency injection container
 * Provides helper methods for getting services with proper type safety and error handling
 *
 * @remarks
 * - Follows SOLID principles (Single Responsibility, Dependency Inversion)
 * - Type-safe service retrieval without using 'any' types
 * - Comprehensive error handling and validation
 * - Uses LoggingService for error logging
 */

import { INestApplication, Logger } from '@nestjs/common';
import type { ServiceToken } from '@core/types/framework.types';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Service Container for type-safe service retrieval
 *
 * @class ServiceContainer
 * @description Provides type-safe access to services from NestJS DI container
 */
export class ServiceContainer {
  private readonly logger: Logger;
  private readonly app: INestApplication;
  private readonly loggingService: LoggingService | undefined;

  /**
   * Create a new ServiceContainer instance
   *
   * @param app - NestJS application instance
   * @param logger - NestJS Logger instance
   * @param loggingService - Optional LoggingService for structured logging
   */
  constructor(app: INestApplication, logger: Logger, loggingService?: LoggingService) {
    this.app = app;
    this.logger = logger;
    this.loggingService = loggingService;
  }

  /**
   * Get token name for error messages
   *
   * @param token - Service token
   * @returns Token name as string
   */
  private getTokenName(token: ServiceToken): string {
    if (typeof token === 'function') {
      const constructorName = (token as { name?: string }).name;
      return constructorName || 'Unknown';
    }
    if (typeof token === 'symbol') {
      return token.toString();
    }
    return String(token);
  }

  /**
   * Get a service from the DI container with type safety
   *
   * @template T - Service type
   * @param token - Service token (class constructor, string, or symbol)
   * @returns Service instance of type T
   * @throws Error if service is not found in DI container
   *
   * @example
   * ```typescript
   * const container = new ServiceContainer(app, logger, loggingService);
   * const configService = container.getService<ConfigService>(ConfigService);
   * const loggingService = container.getService<LoggingService>(LoggingService);
   * ```
   */
  getService<T>(token: ServiceToken): T {
    try {
      // NestJS app.get() returns 'any' in type definitions but is type-safe at runtime
      // We use unknown as intermediate type and validate before returning
      const serviceRaw: unknown = this.app.get(token);
      if (!serviceRaw) {
        const tokenName = this.getTokenName(token);
        const errorMessage = `${tokenName} not found in DI container`;
        this.logger.error(errorMessage);
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            errorMessage,
            'ServiceContainer',
            { token: tokenName }
          );
        }
        throw new Error(errorMessage);
      }
      // Type assertion is safe here - NestJS DI guarantees correct types at runtime
      // Services are registered in AppModule with proper types
      return serviceRaw as T;
    } catch (error) {
      const tokenName = this.getTokenName(token);
      const errorMessage = `Failed to retrieve service ${tokenName}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`;
      this.logger.error(errorMessage);
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          errorMessage,
          'ServiceContainer',
          {
            token: tokenName,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }
      throw error;
    }
  }

  /**
   * Get multiple services at once
   *
   * @template T - Service types tuple
   * @param tokens - Array of service tokens
   * @returns Array of service instances
   *
   * @example
   * ```typescript
   * const [configService, loggingService] = container.getServices([
   *   ConfigService,
   *   LoggingService
   * ]);
   * ```
   */
  getServices<T extends readonly ServiceToken[]>(
    tokens: T
  ): { [K in keyof T]: T[K] extends ServiceToken ? unknown : never } {
    return tokens.map(token => this.getService(token)) as {
      [K in keyof T]: T[K] extends ServiceToken ? unknown : never;
    };
  }

  /**
   * Check if a service exists in the DI container
   *
   * @param token - Service token
   * @returns True if service exists, false otherwise
   */
  hasService(token: ServiceToken): boolean {
    try {
      const service = this.app.get(token, { strict: false });
      return service !== null && service !== undefined;
    } catch {
      return false;
    }
  }
}
