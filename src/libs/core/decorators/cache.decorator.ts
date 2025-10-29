/**
 * Caching decorators for performance optimization
 *
 * This module provides decorators for implementing caching strategies
 * on route handlers to improve performance and reduce database load.
 *
 * @module CacheDecorators
 */

import { SetMetadata } from "@nestjs/common";

/**
 * Cache metadata key
 */
export const CACHE_KEY = "cache" as const;

/**
 * Cache options interface
 */
export interface CacheOptions {
  /** Cache TTL in seconds */
  readonly ttl?: number;
  /** Custom cache key */
  readonly key?: string;
  /** Whether to cache the response */
  readonly enabled?: boolean;
  /** Cache invalidation tags */
  readonly tags?: readonly string[];
  /** Custom key generator function */
  readonly keyGenerator?: (req: unknown) => string;
  /** Whether to skip caching for certain conditions */
  readonly skipIf?: (req: unknown, res: unknown) => boolean;
  /** Cache version for invalidation */
  readonly version?: string;
}

/**
 * Cache decorator for implementing response caching
 *
 * This decorator enables caching of route handler responses to improve
 * performance and reduce database load.
 *
 * @param options - Caching options
 * @returns Decorator function that sets cache metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Get()
 *   @Cache({ ttl: 300 }) // Cache for 5 minutes
 *   async getAppointments() {
 *     return this.appointmentsService.findAll();
 *   }
 *
 *   @Get(':id')
 *   @Cache({ ttl: 600, key: 'appointment' }) // Cache for 10 minutes with custom key
 *   async getAppointment(@Param('id') id: string) {
 *     return this.appointmentsService.findOne(id);
 *   }
 * }
 * ```
 */
export const Cache = (options: CacheOptions = {}): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl: 300, // 5 minutes default
    ...options,
  });

/**
 * Short cache decorator for frequently accessed data
 *
 * This decorator applies short-term caching suitable for
 * frequently accessed data that changes moderately.
 *
 * @param ttl - Cache TTL in seconds (default: 60)
 * @returns Decorator function that sets short cache metadata
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UsersController {
 *   @Get('profile')
 *   @ShortCache() // Cache for 1 minute
 *   async getProfile(@Req() req: Request) {
 *     return this.usersService.getProfile(req.user.id);
 *   }
 * }
 * ```
 */
export const ShortCache = (ttl: number = 60): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    tags: ["short-cache"],
  });

/**
 * Long cache decorator for stable data
 *
 * This decorator applies long-term caching suitable for
 * stable data that doesn't change frequently.
 *
 * @param ttl - Cache TTL in seconds (default: 3600)
 * @returns Decorator function that sets long cache metadata
 *
 * @example
 * ```typescript
 * @Controller('settings')
 * export class SettingsController {
 *   @Get('config')
 *   @LongCache() // Cache for 1 hour
 *   async getConfig() {
 *     return this.settingsService.getConfig();
 *   }
 * }
 * ```
 */
export const LongCache = (ttl: number = 3600): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    tags: ["long-cache"],
  });

/**
 * User-specific cache decorator
 *
 * This decorator applies user-specific caching, useful for
 * personalized data that should be cached per user.
 *
 * @param ttl - Cache TTL in seconds (default: 300)
 * @returns Decorator function that sets user-specific cache metadata
 *
 * @example
 * ```typescript
 * @Controller('dashboard')
 * export class DashboardController {
 *   @Get('stats')
 *   @UserCache() // User-specific cache for 5 minutes
 *   async getStats(@Req() req: Request) {
 *     return this.dashboardService.getUserStats(req.user.id);
 *   }
 * }
 * ```
 */
export const UserCache = (ttl: number = 300): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    keyGenerator: (req: unknown) => {
      const request = req as { user?: { id?: string } };
      return `user:${request.user?.id || "anonymous"}`;
    },
    tags: ["user-cache"],
  });

/**
 * No cache decorator to disable caching
 *
 * This decorator explicitly disables caching for a route handler,
 * useful for dynamic or sensitive data that should never be cached.
 *
 * @returns Decorator function that disables cache metadata
 *
 * @example
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('login')
 *   @NoCache() // Never cache login responses
 *   async login(@Body() loginDto: LoginDto) {
 *     return this.authService.login(loginDto);
 *   }
 * }
 * ```
 */
export const NoCache = (): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: false,
  });
