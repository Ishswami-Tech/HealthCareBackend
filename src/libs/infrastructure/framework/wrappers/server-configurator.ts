/**
 * Server Configurator
 *
 * @module ServerConfigurator
 * @description Centralizes server-level configuration
 * Handles port, host, environment-based settings, and server optimizations
 *
 * @remarks
 * - Follows SOLID principles (Single Responsibility)
 * - Environment-aware configuration
 * - Type-safe configuration management
 * - Uses ConfigService for configuration values
 */

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@config';
import type { ServerConfig, ApplicationConfig } from '@core/types/framework.types';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Server configuration options
 */
export interface ServerConfigurationOptions {
  readonly environment: 'development' | 'production';
  readonly configService?: ConfigService;
  readonly defaultPort?: number;
  readonly defaultHost?: string;
}

/**
 * Server Configurator
 *
 * @class ServerConfigurator
 * @description Manages server configuration and settings
 */
export class ServerConfigurator {
  private readonly logger: Logger;
  private readonly loggingService: LoggingService | undefined;
  private readonly configService: ConfigService | undefined;
  private readonly environment: 'development' | 'production';

  /**
   * Create a new ServerConfigurator instance
   *
   * @param logger - NestJS Logger instance
   * @param options - Server configuration options
   * @param loggingService - Optional LoggingService for structured logging
   */
  constructor(
    logger: Logger,
    options: ServerConfigurationOptions,
    loggingService?: LoggingService
  ) {
    this.logger = logger;
    this.loggingService = loggingService;
    this.configService = options.configService;
    this.environment = options.environment;
  }

  /**
   * Get server configuration
   *
   * @returns ServerConfig - Server configuration object
   */
  getServerConfig(): ServerConfig {
    const port =
      this.configService?.get<number | string>('PORT') ||
      this.configService?.get<number | string>('VIRTUAL_PORT') ||
      process.env['PORT'] ||
      process.env['VIRTUAL_PORT'] ||
      8088;

    const host =
      this.configService?.get<string>('VIRTUAL_HOST') ||
      process.env['VIRTUAL_HOST'] ||
      process.env['HOST'] ||
      '0.0.0.0';

    const bindAddress =
      this.configService?.get<string>('BIND_ADDRESS') || process.env['BIND_ADDRESS'] || host;

    const portNumber = typeof port === 'string' ? parseInt(port, 10) : port;

    if (isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) {
      const errorMessage = `Invalid port number: ${port}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    const config: ServerConfig = {
      port: portNumber,
      host,
      bindAddress,
    };

    this.logger.log(`Server configuration: ${host}:${portNumber}`);

    return config;
  }

  /**
   * Get application configuration based on environment
   *
   * @param instanceId - Instance identifier for horizontal scaling
   * @param isHorizontalScaling - Whether horizontal scaling is enabled
   * @returns ApplicationConfig - Application configuration object
   */
  getApplicationConfig(instanceId: string, isHorizontalScaling: boolean): ApplicationConfig {
    const trustProxyValue =
      this.configService?.get<string>('TRUST_PROXY') || process.env['TRUST_PROXY'] || '0';
    const trustProxy = trustProxyValue === '1' || trustProxyValue === 'true';

    const bodyLimit =
      this.environment === 'production'
        ? 50 * 1024 * 1024 // 50MB in production
        : 10 * 1024 * 1024; // 10MB in development

    const keepAliveTimeout = this.environment === 'production' ? 65000 : 5000;

    const connectionTimeout = this.environment === 'production' ? 60000 : 30000;

    const requestTimeout = this.environment === 'production' ? 30000 : 10000;

    const enableHttp2 =
      this.environment === 'production' && process.env['ENABLE_HTTP2'] !== 'false';

    const config: ApplicationConfig = {
      environment: this.environment,
      isHorizontalScaling,
      instanceId,
      trustProxy,
      bodyLimit,
      keepAliveTimeout,
      connectionTimeout,
      requestTimeout,
      enableHttp2,
    };

    if (this.loggingService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Application configuration generated',
        'ServerConfigurator',
        {
          environment: this.environment,
          instanceId,
          isHorizontalScaling,
          trustProxy,
          bodyLimit,
          enableHttp2,
        }
      );
    }

    return config;
  }

  /**
   * Validate server configuration
   *
   * @param config - Server configuration to validate
   * @returns boolean - True if configuration is valid
   */
  validateServerConfig(config: ServerConfig): boolean {
    if (config.port <= 0 || config.port > 65535) {
      this.logger.error(`Invalid port: ${config.port}`);
      return false;
    }

    if (!config.host || config.host.trim() === '') {
      this.logger.error('Invalid host: empty or undefined');
      return false;
    }

    return true;
  }
}
