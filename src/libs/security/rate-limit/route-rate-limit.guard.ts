import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import {
  RATE_LIMIT_KEY as CORE_RATE_LIMIT_KEY,
  type RateLimitOptions as CoreRateLimitOptions,
} from '@core/decorators/rate-limit.decorator';

import {
  RATE_LIMIT_KEY as SECURITY_RATE_LIMIT_KEY,
  type RateLimitConfig as SecurityRateLimitConfig,
} from './rate-limit.decorator';
import {
  extractBearerToken,
  extractHashedIdentifier,
  parseIpList,
  resolveRequestIp,
  resolveVerifiedSubject,
  type RateLimitRequestLike,
} from './rate-limit-keys.util';
import { RateLimitService } from './rate-limit.service';
import { withRetryWait } from './retry-wait.util';

/** Normalised metadata from either decorator family. */
interface RouteLimit {
  readonly max: number;
  readonly windowMs: number;
  readonly message: string;
  readonly skipIf?: (req: RateLimitRequestLike) => boolean;
  readonly keyGenerator?: (req: RateLimitRequestLike) => string;
}

interface Bucket {
  readonly key: string;
  readonly max: number;
}

interface ReplyLike {
  header?: (name: string, value: string) => void;
}

const DEFAULT_IP_MULTIPLIER = 10;

/**
 * Enforces the per-endpoint `@RateLimitAPI()` / `@RateLimitOTP()` / `@RateLimit()` decorators.
 * Before this guard existed both decorator families only set metadata and nothing read it.
 *
 * Registered globally (APP_GUARD in RateLimitModule), so it runs before controller guards and
 * derives identity itself from a VERIFIED bearer token (never an unverified `sub`).
 *
 * Buckets per decorated route (all must pass):
 *  - authenticated: `user:<sub>` at the decorator's `max`
 *  - anonymous with a login identifier in the body (login / OTP / reset routes):
 *      `id:<sha256(identifier)>` at `max` (independent of IP and User-Agent), plus
 *      `ip:<client ip>` at `max * RATE_LIMIT_ROUTE_IP_MULTIPLIER` (NAT-safe spray cap)
 *  - anonymous without identifier: `ip:<client ip>` at `max * multiplier`
 * IPs in RATE_LIMIT_TRUSTED_IPS (e.g. the Next.js server's egress IP, which carries every web
 * user) skip the IP buckets only; identifier and user buckets still apply.
 *
 * Disabled in development unless RATE_LIMIT_ENFORCE_IN_DEV=true. Fails open if the cache is down
 * (same policy as RateLimitService).
 */
@Injectable()
export class RouteRateLimitGuard implements CanActivate {
  private readonly ipMultiplier: number;
  private readonly trustedIps: ReadonlySet<string>;
  private readonly enforceInDev: boolean;

  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => RateLimitService))
    private readonly rateLimitService: RateLimitService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.ipMultiplier = Math.max(
      1,
      this.configService.getEnvNumber('RATE_LIMIT_ROUTE_IP_MULTIPLIER', DEFAULT_IP_MULTIPLIER)
    );
    this.trustedIps = parseIpList(this.configService.getEnv('RATE_LIMIT_TRUSTED_IPS'));
    this.enforceInDev = this.configService.getEnvBoolean('RATE_LIMIT_ENFORCE_IN_DEV', false);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const limit = this.readRouteLimit(context);
    if (!limit) {
      return true;
    }
    const isDevelopment = this.configService.isDevelopment();
    if (isDevelopment && !this.enforceInDev) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitRequestLike>();
    if (limit.skipIf?.(request)) {
      return true;
    }

    const route = `${context.getClass().name}.${context.getHandler().name}`;
    const buckets = this.buildBuckets(route, limit, request);
    for (const bucket of buckets) {
      const result = await this.rateLimitService.checkRateLimit(bucket.key, {
        windowMs: limit.windowMs,
        max: bucket.max,
        bypassDev: isDevelopment && this.enforceInDev,
      });
      if (!result.allowed) {
        this.reject(context, route, bucket, limit, result.resetTime);
      }
    }
    return true;
  }

  private readRouteLimit(context: ExecutionContext): RouteLimit | null {
    const targets = [context.getHandler(), context.getClass()];
    const security = this.reflector.getAllAndOverride<SecurityRateLimitConfig | undefined>(
      SECURITY_RATE_LIMIT_KEY,
      targets
    );
    if (security && security.max > 0 && security.windowMs > 0) {
      return {
        max: security.max,
        windowMs: security.windowMs,
        message: security.message || 'Too many requests',
      };
    }
    const core = this.reflector.getAllAndOverride<CoreRateLimitOptions | undefined>(
      CORE_RATE_LIMIT_KEY,
      targets
    );
    if (core && core.max > 0 && core.windowMs > 0) {
      return {
        max: core.max,
        windowMs: core.windowMs,
        message: core.message || 'Too many requests',
        ...(core.skipIf && { skipIf: core.skipIf }),
        ...(core.keyGenerator && { keyGenerator: core.keyGenerator }),
      };
    }
    return null;
  }

  private buildBuckets(
    route: string,
    limit: RouteLimit,
    request: RateLimitRequestLike
  ): readonly Bucket[] {
    const prefix = `route:${route}`;
    if (limit.keyGenerator) {
      return [{ key: `${prefix}:custom:${limit.keyGenerator(request)}`, max: limit.max }];
    }

    const jwtSecret = this.configService.getJwtConfig()?.secret || '';
    const subject = resolveVerifiedSubject(extractBearerToken(request.headers), jwtSecret);
    if (subject) {
      return [{ key: `${prefix}:user:${subject}`, max: limit.max }];
    }

    const buckets: Bucket[] = [];
    const identifier = extractHashedIdentifier(request.body);
    if (identifier) {
      buckets.push({ key: `${prefix}:id:${identifier}`, max: limit.max });
    }
    const ip = resolveRequestIp(request);
    if (!this.trustedIps.has(ip)) {
      buckets.push({ key: `${prefix}:ip:${ip}`, max: limit.max * this.ipMultiplier });
    }
    return buckets;
  }

  private reject(
    context: ExecutionContext,
    route: string,
    bucket: Bucket,
    limit: RouteLimit,
    resetTime: Date
  ): never {
    const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    const reply = context.switchToHttp().getResponse<ReplyLike>();
    reply.header?.('Retry-After', String(retryAfter));
    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.WARN,
      'Route rate limit exceeded',
      'RouteRateLimitGuard',
      // The bucket key holds a user id, a hashed identifier or an IP - never a raw phone/email.
      { route, bucket: bucket.key, max: bucket.max, windowMs: limit.windowMs }
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: withRetryWait(limit.message, retryAfter),
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}
