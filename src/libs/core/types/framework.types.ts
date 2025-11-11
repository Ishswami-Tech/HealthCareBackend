/**
 * Framework Wrapper Types
 *
 * @module FrameworkTypes
 * @description Type definitions for framework abstraction layer wrappers
 * Centralized types for application lifecycle, middleware, services, and bootstrap
 */

import { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import type { IFrameworkAdapter } from '@infrastructure/framework';
import type { LoggingService } from '@infrastructure/logging';
import type { ConfigService } from '@config';
import type { SecurityConfigService } from '@security/security-config.service';
import type { GracefulShutdownService } from '@core/resilience/graceful-shutdown.service';
import type { ProcessErrorHandlersService } from '@core/resilience/graceful-shutdown.service';
import type { IoAdapter } from '@nestjs/platform-socket.io';
import type { RedisClient } from './common.types';

/**
 * Service token type for NestJS dependency injection
 */
export type ServiceToken = string | symbol | (new (...args: never[]) => unknown);

/**
 * Application configuration options
 */
export interface ApplicationConfig {
  readonly environment: 'development' | 'production';
  readonly isHorizontalScaling: boolean;
  readonly instanceId: string;
  readonly trustProxy: boolean;
  readonly bodyLimit: number;
  readonly keepAliveTimeout: number;
  readonly connectionTimeout: number;
  readonly requestTimeout: number;
  readonly enableHttp2?: boolean;
}

/**
 * Middleware configuration options
 */
export interface MiddlewareConfig {
  readonly validationPipe?: ValidationPipeOptions;
  readonly enableVersioning?: boolean;
  readonly versioningType?: 'header' | 'uri' | 'media-type';
  readonly versioningHeader?: string;
  readonly defaultVersion?: string;
  readonly globalPrefix?: string;
  readonly prefixExclude?: string[];
  readonly enableShutdownHooks?: boolean;
}

/**
 * Server configuration options
 */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly bindAddress?: string;
}

/**
 * Service container configuration
 */
export interface ServiceContainerConfig {
  readonly app: INestApplication;
  readonly logger: Logger;
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  readonly appModule: unknown;
  readonly applicationConfig: ApplicationConfig;
  readonly middlewareConfig?: MiddlewareConfig;
  readonly serverConfig: ServerConfig;
  readonly logger: Logger;
  readonly configService?: ConfigService;
  readonly loggingService?: LoggingService;
  readonly securityConfigService?: SecurityConfigService;
  readonly gracefulShutdownService?: GracefulShutdownService;
  readonly processErrorHandlersService?: ProcessErrorHandlersService;
  readonly customWebSocketAdapter?: IoAdapter | null;
  readonly redisPubClient?: RedisClient | null;
  readonly redisSubClient?: RedisClient | null;
}

/**
 * Application context returned after bootstrap
 */
export interface ApplicationContext {
  readonly app: INestApplication;
  readonly frameworkAdapter: IFrameworkAdapter;
  readonly configService: ConfigService;
  readonly loggingService: LoggingService;
  readonly securityConfigService: SecurityConfigService;
  readonly gracefulShutdownService: GracefulShutdownService;
  readonly processErrorHandlersService: ProcessErrorHandlersService;
  readonly serverConfig: ServerConfig;
}

/**
 * Pipe configuration
 */
export interface PipeConfig {
  readonly pipe: unknown;
  readonly options?: ValidationPipeOptions;
}

/**
 * Filter configuration
 */
export interface FilterConfig {
  readonly filter: unknown;
  readonly options?: Record<string, unknown>;
  readonly constructorArgs?: readonly unknown[]; // Constructor arguments for filters that require dependencies
}

/**
 * Interceptor configuration
 */
export interface InterceptorConfig {
  readonly interceptor: unknown;
  readonly options?: Record<string, unknown>;
  readonly constructorArgs?: readonly unknown[]; // Constructor arguments for interceptors that require dependencies
}

/**
 * Versioning configuration
 */
export interface VersioningConfig {
  readonly type: 'header' | 'uri' | 'media-type';
  readonly header?: string;
  readonly uriPrefix?: string;
  readonly defaultVersion?: string;
}

/**
 * Global prefix configuration
 */
export interface GlobalPrefixConfig {
  readonly prefix: string;
  readonly exclude?: Array<string | { path: string; method: string }>;
}

/**
 * Application lifecycle events
 */
export enum ApplicationLifecycleEvent {
  CREATED = 'application.created',
  CONFIGURED = 'application.configured',
  STARTED = 'application.started',
  SHUTTING_DOWN = 'application.shutting_down',
  SHUTDOWN = 'application.shutdown',
}

/**
 * Bootstrap stage
 */
export enum BootstrapStage {
  INITIALIZING = 'initializing',
  CREATING_APPLICATION = 'creating_application',
  CONFIGURING_MIDDLEWARE = 'configuring_middleware',
  SETTING_UP_SERVICES = 'setting_up_services',
  STARTING_SERVER = 'starting_server',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
