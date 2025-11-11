import { Injectable, Logger, INestApplication } from '@nestjs/common';
import { ConfigService } from '@config';
import type { AuthenticatedRequest, RateLimitContext } from '@core/types';
import { IFrameworkAdapter, IFastifyFrameworkAdapter } from '@infrastructure/framework';

/**
 * Security Configuration Service
 *
 * Centralizes all security-related middleware configuration including:
 * - Rate limiting (global Fastify plugin)
 * - CORS
 * - Helmet security headers (includes Swagger UI CSP requirements)
 * - Bot detection
 * - Compression
 * - Multipart handling
 *
 * @class SecurityConfigService
 * @description Enterprise-grade security configuration for healthcare applications
 *
 * @remarks
 * - Follows DRY principle - all security middleware configured in one place
 * - Helmet CSP includes Swagger UI requirements ('unsafe-inline', 'unsafe-eval')
 * - Rate limiting uses @fastify/rate-limit plugin for global middleware
 * - For programmatic rate limiting, use RateLimitService from @security/rate-limit
 * - For cache-based rate limiting, use RedisService.isRateLimited()
 */
@Injectable()
export class SecurityConfigService {
  private readonly logger = new Logger(SecurityConfigService.name);
  private frameworkAdapter: IFrameworkAdapter | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Set the framework adapter (called from main.ts after adapter creation)
   *
   * @param adapter - Framework adapter instance
   */
  setFrameworkAdapter(adapter: IFrameworkAdapter): void {
    this.frameworkAdapter = adapter;
  }

  /**
   * Check if the framework adapter supports Fastify-specific features
   *
   * @param adapter - Framework adapter to check
   * @returns adapter is IFastifyFrameworkAdapter - Type guard
   */
  private isFastifyAdapter(adapter: IFrameworkAdapter | null): adapter is IFastifyFrameworkAdapter {
    return (
      adapter !== null &&
      adapter.getFrameworkName() === 'fastify' &&
      'registerHelmet' in adapter &&
      typeof adapter.registerHelmet === 'function' &&
      'registerCompression' in adapter &&
      typeof adapter.registerCompression === 'function' &&
      'registerRateLimit' in adapter &&
      typeof adapter.registerRateLimit === 'function' &&
      'registerMultipart' in adapter &&
      typeof adapter.registerMultipart === 'function'
    );
  }

  /**
   * Get the framework adapter as Fastify adapter (with type guard)
   *
   * @returns IFastifyFrameworkAdapter - The Fastify framework adapter
   * @throws Error if adapter is not Fastify-based
   */
  private getFastifyAdapter(): IFastifyFrameworkAdapter {
    const adapter = this.frameworkAdapter;
    if (!adapter) {
      throw new Error('Framework adapter is not set');
    }
    // Validate adapter is Fastify-based with type guard
    if (this.isFastifyAdapter(adapter)) {
      // Type guard narrows the type here - TypeScript understands this
      return adapter;
    }
    throw new Error('Framework adapter is not Fastify-based');
  }

  /**
   * Configure all production security middleware
   *
   * @param app - NestJS application instance (framework-agnostic)
   * @param logger - Logger instance
   * @returns Promise<void>
   *
   * @description
   * Configures all production security middleware using the framework adapter.
   * This method is framework-agnostic and works with any framework adapter.
   */
  async configureProductionSecurity(app: INestApplication, logger: Logger): Promise<void> {
    if (!this.frameworkAdapter) {
      throw new Error('Framework adapter must be set before configuring security');
    }

    if (!this.isFastifyAdapter(this.frameworkAdapter)) {
      throw new Error('Security configuration currently only supports Fastify framework');
    }

    logger.log('Configuring production security middleware...');

    await Promise.all([
      this.configureCompression(app),
      this.configureRateLimiting(app),
      this.configureMultipart(app),
      this.configureHelmet(app),
    ]);

    logger.log('Production security middleware configured');
  }

  /**
   * Configure compression middleware
   *
   * @param app - NestJS application instance
   * @returns Promise<void>
   */
  private async configureCompression(app: INestApplication): Promise<void> {
    const adapter = this.getFastifyAdapter();
    await adapter.registerCompression(app, {
      global: true,
      threshold: 1024,
      encodings: ['gzip', 'deflate', 'br'],
      brotliOptions: {
        quality: 4,
        windowBits: 22,
        mode: 'text',
      },
      gzipOptions: {
        level: 6,
        windowBits: 15,
        memLevel: 8,
      },
    });
  }

  /**
   * Configure rate limiting middleware
   *
   * @param app - NestJS application instance
   * @returns Promise<void>
   */
  private async configureRateLimiting(app: INestApplication): Promise<void> {
    const adapter = this.getFastifyAdapter();
    await adapter.registerRateLimit(app, {
      max: parseInt(process.env['RATE_LIMIT_MAX'] || '1000', 10),
      timeWindow: process.env['RATE_LIMIT_WINDOW'] || '1 minute',
      redis:
        this.configService?.get('REDIS_URL') || process.env['REDIS_URL']
          ? {
              host:
                this.configService?.get<string>('REDIS_HOST') ||
                process.env['REDIS_HOST'] ||
                'localhost',
              port:
                this.configService?.get<number>('REDIS_PORT') ||
                parseInt(process.env['REDIS_PORT'] || '6379', 10),
              ...((
                this.configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD']
              )?.trim() && {
                password: (
                  this.configService?.get<string>('REDIS_PASSWORD') || process.env['REDIS_PASSWORD']
                )?.trim(),
              }),
            }
          : undefined,
      keyGenerator: (request: Partial<AuthenticatedRequest>) => {
        const ip = request.ip || 'unknown';
        const userAgent = request.headers?.['user-agent'];
        const userAgentStr = typeof userAgent === 'string' ? userAgent : 'unknown';
        return `${ip}:${userAgentStr}`;
      },
      errorResponseBuilder: (request: Partial<AuthenticatedRequest>, context: RateLimitContext) => {
        return {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${Math.round(context.ttl / 1000)} seconds.`,
          retryAfter: Math.round(context.ttl / 1000),
        };
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });
  }

  /**
   * Configure multipart form data handling
   *
   * @param app - NestJS application instance
   * @returns Promise<void>
   */
  private async configureMultipart(app: INestApplication): Promise<void> {
    const adapter = this.getFastifyAdapter();
    await adapter.registerMultipart(app, {
      limits: {
        fieldNameSize: 100,
        fieldSize: 1000000, // 1MB
        fields: 10,
        fileSize: 50 * 1024 * 1024, // 50MB
        files: 5,
        headerPairs: 2000,
      },
      attachFieldsToBody: true,
    });
  }

  /**
   * Configure Helmet security headers
   * Includes Swagger UI CSP requirements ('unsafe-inline', 'unsafe-eval') for production
   * This is the single source of truth for Helmet configuration (DRY principle)
   *
   * @param app - NestJS application instance
   * @returns Promise<void>
   */
  private async configureHelmet(app: INestApplication): Promise<void> {
    const adapter = this.getFastifyAdapter();

    // Build CSP directives - includes Swagger UI requirements
    // 'unsafe-inline' and 'unsafe-eval' are required for Swagger UI to function
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'", // Required for Swagger UI
      "'unsafe-eval'", // Required for Swagger UI
      'https://accounts.google.com',
      'https://apis.google.com',
      'https://www.googleapis.com',
    ] as readonly string[];

    const styleSrc = [
      "'self'",
      "'unsafe-inline'", // Required for Swagger UI
      'https://fonts.googleapis.com',
    ] as readonly string[];

    const imgSrc = ["'self'", 'data:', 'https:', 'blob:'] as readonly string[];

    const connectSrc = [
      "'self'",
      this.configService?.get<string>('FRONTEND_URL', '') || process.env['FRONTEND_URL'] || '',
      this.configService?.get<string>('API_URL', '') || process.env['API_URL'] || '',
      (this.configService?.get<string>('API_URL', '') || process.env['API_URL'] || '')
        .replace('http://', 'wss://')
        .replace('https://', 'wss://'),
      'https://accounts.google.com',
      'https://oauth2.googleapis.com',
      'https://www.googleapis.com',
    ].filter(Boolean) as readonly string[];

    await adapter.registerHelmet(app, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"] as readonly string[],
          scriptSrc,
          styleSrc,
          imgSrc,
          connectSrc,
          fontSrc: ["'self'", 'https://fonts.gstatic.com'] as readonly string[],
          frameSrc: ["'self'", 'https://accounts.google.com'] as readonly string[],
          objectSrc: ["'none'"] as readonly string[],
          baseUri: ["'self'"] as readonly string[],
          formAction: [
            "'self'",
            'https://accounts.google.com',
            this.configService?.get<string>('FRONTEND_URL', '') ||
              process.env['FRONTEND_URL'] ||
              '',
          ].filter(Boolean) as readonly string[],
          frameAncestors: ["'none'"] as readonly string[],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    });
  }

  /**
   * Configure CORS
   *
   * @param app - NestJS application instance (framework-agnostic)
   * @returns void
   *
   * @description
   * Configures CORS using NestJS's built-in CORS support.
   * This method is framework-agnostic.
   */
  configureCORS(app: INestApplication): void {
    const corsOrigin =
      this.configService?.get<string>('CORS_ORIGIN', '*') || process.env['CORS_ORIGIN'] || '*';
    const corsOrigins =
      corsOrigin === '*' ? '*' : corsOrigin.split(',').map(origin => origin.trim());

    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-ID',
        'X-Clinic-ID',
        'Origin',
        'Accept',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers',
        'X-Client-Data',
        'Sec-Fetch-Site',
        'Sec-Fetch-Mode',
        'Sec-Fetch-Dest',
      ],
      exposedHeaders: ['Set-Cookie', 'Authorization'],
      maxAge: 86400, // 24 hours
    });
  }

  /**
   * Add CORS preflight handler
   *
   * @param app - NestJS application instance
   * @returns void
   *
   * @description
   * Adds a CORS preflight handler using the framework adapter's hook system.
   */
  addCorsPreflightHandler(app: INestApplication): void {
    if (!this.frameworkAdapter) {
      throw new Error('Framework adapter must be set before adding CORS preflight handler');
    }

    this.frameworkAdapter.addHook(app, 'onRequest', (request, reply, done) => {
      // Type-safe access to request properties (framework-agnostic)
      const requestTyped = request as {
        method?: string;
        headers?: { origin?: string };
      };
      const replyTyped = reply as {
        header: (name: string, value: string) => typeof replyTyped;
        send: () => void;
      };

      // Handle preflight requests
      if (requestTyped.method === 'OPTIONS') {
        const origin = requestTyped.headers?.origin;
        if (origin) {
          const corsOrigin =
            this.configService?.get<string>('CORS_ORIGIN', '*') ||
            process.env['CORS_ORIGIN'] ||
            '*';
          const allowedOrigins =
            corsOrigin === '*' ? ['*'] : corsOrigin.split(',').map((o: string) => o.trim());

          if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            replyTyped.header('Access-Control-Allow-Origin', origin);
            replyTyped.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            replyTyped.header(
              'Access-Control-Allow-Headers',
              'Content-Type, Authorization, X-Session-ID, X-Clinic-ID, Origin, Accept, X-Requested-With, Access-Control-Request-Method, Access-Control-Request-Headers, X-Client-Data, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest'
            );
            replyTyped.header('Access-Control-Allow-Credentials', 'true');
            replyTyped.header('Access-Control-Max-Age', '86400');
            replyTyped.send();
            return;
          }
        }
      }
      if (done) {
        done();
      }
    });
  }

  /**
   * Add bot scan detection hook to reduce log noise
   *
   * @param app - NestJS application instance
   * @returns void
   *
   * @description
   * Adds a bot detection hook using the framework adapter's hook system.
   * Detects common bot scan patterns and returns 404 immediately.
   */
  addBotDetectionHook(app: INestApplication): void {
    if (!this.frameworkAdapter) {
      throw new Error('Framework adapter must be set before adding bot detection hook');
    }

    this.frameworkAdapter.addHook(app, 'onRequest', (request, reply, done) => {
      // Type-safe access to request properties (framework-agnostic)
      const requestTyped = request as {
        url?: string;
        headers?: { 'user-agent'?: string };
      };
      const replyTyped = reply as {
        status: (code: number) => { send: (data: Record<string, string>) => void };
      };

      const path = requestTyped.url || '';
      const userAgent = requestTyped.headers?.['user-agent'] || '';

      // Check if this is likely a bot scan
      const isBotScan =
        path.includes('admin') ||
        path.includes('wp-') ||
        path.includes('php') ||
        path.includes('cgi-bin') ||
        path.includes('config') ||
        userAgent.toLowerCase().includes('bot') ||
        userAgent.toLowerCase().includes('crawler') ||
        userAgent.toLowerCase().includes('spider');

      if (isBotScan) {
        // For bot scans, return 404 immediately without further processing
        replyTyped.status(404).send({ error: 'Not Found' });
        return;
      }

      if (done) {
        done();
      }
    });
  }
}
