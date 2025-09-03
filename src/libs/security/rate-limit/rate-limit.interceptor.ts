import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
  forwardRef,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RateLimitInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => RateLimitService))
    private readonly rateLimitService: RateLimitService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const rateLimitOptions = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!rateLimitOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const identifier = this.getIdentifier(request, rateLimitOptions);
    const type = rateLimitOptions.type || 'api';

    try {
      const result = await this.rateLimitService.checkRateLimit(identifier, type);

      if (result.limited) {
        this.logger.warn(
          `Rate limit exceeded for ${identifier} (${type}) - IP: ${request.ip}`,
        );

        const response = context.switchToHttp().getResponse();
        const limits = this.rateLimitService.config.getLimits(type);
        response.setHeader('X-RateLimit-Limit', limits.maxRequests);
        response.setHeader('X-RateLimit-Remaining', 0);
        if (result.resetTime) {
          response.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
        }

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Rate limit exceeded. Please try again later.',
            error: 'Too Many Requests',
            rateLimitInfo: {
              type,
              identifier,
              remaining: result.remaining,
              resetTime: result.resetTime,
            },
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Set rate limit headers
      const response = context.switchToHttp().getResponse();
      const limits = this.rateLimitService.config.getLimits(type);
      response.setHeader('X-RateLimit-Limit', limits.maxRequests);
      response.setHeader('X-RateLimit-Remaining', result.remaining);
      if (result.resetTime) {
        response.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
      }

      return next.handle();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Rate limit check failed for ${identifier}: ${error.message}`,
      );
      // If rate limiting fails, allow the request to proceed
      return next.handle();
    }
  }

  private getIdentifier(request: any, options: RateLimitOptions): string {
    // Use custom identifier if provided
    if (options.identifier) {
      return options.identifier;
    }

    // For authentication endpoints, use IP address
    if (options.type?.startsWith('auth/')) {
      return request.ip || 'unknown';
    }

    // For API endpoints, use user ID if authenticated, otherwise IP
    if (request.user?.id) {
      return `user:${request.user.id}`;
    }

    return request.ip || 'unknown';
  }
}
