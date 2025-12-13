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
      typeof adapter.registerMultipart === 'function' &&
      'registerCookie' in adapter &&
      typeof adapter.registerCookie === 'function' &&
      'registerSession' in adapter &&
      typeof adapter.registerSession === 'function'
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
      this.configureCookies(app),
      // Session will be configured separately with store from SessionManagementService
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
    // Use ConfigService (which uses dotenv) for all environment variable access
    const rateLimitConfig = this.configService.getRateLimitConfig();
    await adapter.registerRateLimit(app, {
      max: rateLimitConfig.max,
      timeWindow: this.configService.getEnv('RATE_LIMIT_WINDOW', '1 minute'),
      redis: (() => {
        // Use ConfigService (which uses dotenv) for environment variable access
        const cacheHost = this.configService.getCacheHost();
        const cachePort = this.configService.getCachePort();
        const cachePassword = this.configService.getCachePassword();

        return {
          host: cacheHost,
          port: cachePort,
          ...(cachePassword?.trim() && {
            password: cachePassword.trim(),
          }),
        };
      })(),
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

    // Use ConfigService (which uses dotenv) for environment variable access
    const urlsConfig = this.configService.getUrlsConfig();
    const appConfig = this.configService.getAppConfig();
    const connectSrc = [
      "'self'",
      urlsConfig.frontend || '',
      appConfig.apiUrl || '',
      (appConfig.apiUrl || '').replace('http://', 'wss://').replace('https://', 'wss://'),
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
          formAction: ["'self'", 'https://accounts.google.com', urlsConfig.frontend || ''].filter(
            Boolean
          ) as readonly string[],
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
    // Use ConfigService (which uses dotenv) for environment variable access
    const corsConfig = this.configService.getCorsConfig();
    const corsOrigin = corsConfig.origin || '*';
    const corsOrigins =
      corsOrigin === '*'
        ? '*'
        : corsOrigin.split(',').map((origin: string) => origin.trim());

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
          // Use ConfigService (which uses dotenv) for environment variable access
          const corsConfig = this.configService.getCorsConfig();
          const corsOrigin = corsConfig.origin || '*';
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
   * Configure Cookie plugin
   *
   * @param app - NestJS application instance
   * @returns Promise<void>
   *
   * @description
   * Configures the @fastify/cookie plugin for handling HTTP cookies.
   * Must be configured before session plugin.
   */
  async configureCookies(app: INestApplication): Promise<void> {
    const adapter = this.getFastifyAdapter();
    // Type guard ensures adapter has registerCookie method
    if (!adapter || typeof adapter.registerCookie !== 'function') {
      throw new Error('Fastify adapter does not support cookie registration');
    }
    // Use ConfigService (which uses dotenv) for environment variable access
    const cookieSecret = this.configService.getEnv(
      'COOKIE_SECRET',
      'default-cookie-secret-change-in-production-min-32-chars'
    );

    const cookieOptions = {
      secret: cookieSecret,
      parseOptions: {},
    };

    // Use Reflect.apply to call method with proper 'this' binding - avoids ESLint unbound-method warning
    const methodName: keyof IFastifyFrameworkAdapter = 'registerCookie';
    const method = adapter[methodName];
    if (typeof method !== 'function') {
      throw new Error('registerCookie is not a function');
    }
    await Reflect.apply(method, adapter, [app, cookieOptions]);
  }

  /**
   * Configure Session plugin
   *
   * @param app - NestJS application instance
   * @param store - Optional session store adapter (if not provided, uses in-memory store)
   * @returns Promise<void>
   *
   * @description
   * Configures the @fastify/session plugin for managing user sessions.
   * Uses CacheService via FastifySessionStoreAdapter for cache-backed storage (Dragonfly/Redis)
   * if store is provided. CacheService is provider-agnostic and works with any configured cache backend.
   */
  async configureSession(app: INestApplication, store?: unknown): Promise<void> {
    const adapter = this.getFastifyAdapter();
    // Type guard ensures adapter has registerSession method
    if (!adapter || typeof adapter.registerSession !== 'function') {
      throw new Error('Fastify adapter does not support session registration');
    }

    // Get session secret from config (must be at least 32 characters)
    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionSecret =
      this.configService.getEnv(
        'SESSION_SECRET',
        'default-session-secret-change-in-production-min-32-chars-long'
      ) || 'default-session-secret-change-in-production-min-32-chars-long';

    if (sessionSecret && sessionSecret.length < 32) {
      this.logger.warn(
        'SESSION_SECRET is less than 32 characters. Please use a longer secret for production.'
      );
    }

    // Session timeout in milliseconds (default: 24 hours)
    // Use ConfigService (which uses dotenv) for environment variable access
    const sessionTimeout = this.configService.getEnvNumber('SESSION_TIMEOUT', 86400);
    const maxAge = sessionTimeout * 1000;

    // Cookie configuration
    const secureCookies = this.configService.getEnvBoolean('SESSION_SECURE_COOKIES', true);
    const sameSite = (this.configService.getEnv('SESSION_SAME_SITE', 'strict') || 'strict') as
      | 'strict'
      | 'lax'
      | 'none';

    const sessionOptions: Record<string, unknown> = {
      secret: sessionSecret,
      cookie: {
        secure: secureCookies,
        httpOnly: true,
        sameSite,
        maxAge,
        path: '/',
      },
      cookieName: 'healthcare.session',
    };

    // Add store if provided and valid
    // Wrap in try-catch to handle any errors during store wrapper creation
    if (store) {
      try {
        // Validate store has required methods before adding
        const storeObj = store as {
          set?: (sid: string, session: unknown, callback: (err?: unknown) => void) => void;
          get?: (sid: string, callback: (err: unknown, result?: unknown) => void) => void;
          destroy?: (sid: string, callback: (err?: unknown) => void) => void;
          touch?: (sid: string, session: unknown, callback: (err?: unknown) => void) => void;
        };

        // CRITICAL: Validate store object and methods exist BEFORE attempting to bind
        if (
          typeof store !== 'object' ||
          store === null ||
          typeof storeObj.set !== 'function' ||
          typeof storeObj.get !== 'function' ||
          typeof storeObj.destroy !== 'function'
        ) {
          this.logger.warn(
            'Session store provided but does not implement required methods (set, get, destroy). Using in-memory store instead.'
          );
        } else {
          // All methods exist, now bind them
          // Use direct method access (not optional chaining) since we've validated they exist
          const boundGet = storeObj.get.bind(store);
          const boundSet = storeObj.set.bind(store);
          const boundDestroy = storeObj.destroy.bind(store);

          // Validate bound methods are functions (should always be true, but double-check)
          if (
            typeof boundGet !== 'function' ||
            typeof boundSet !== 'function' ||
            typeof boundDestroy !== 'function'
          ) {
            this.logger.warn(
              'Session store methods failed to bind properly. Using in-memory store instead.'
            );
          } else {
            // Create store wrapper with bound methods
            const storeWrapper: {
              get: (sid: string, callback: (err: unknown, result?: unknown) => void) => void;
              set: (sid: string, session: unknown, callback: (err?: unknown) => void) => void;
              destroy: (sid: string, callback: (err?: unknown) => void) => void;
              touch?: (sid: string, session: unknown, callback: (err?: unknown) => void) => void;
            } = {
              get: boundGet,
              set: boundSet,
              destroy: boundDestroy,
            };

            // Add touch method if available
            if (typeof storeObj.touch === 'function') {
              const boundTouch = storeObj.touch.bind(store);
              if (typeof boundTouch === 'function') {
                storeWrapper.touch = boundTouch;
              }
            }

            // Final validation - ensure wrapper has all required methods and they're callable
            if (
              typeof storeWrapper.get === 'function' &&
              typeof storeWrapper.set === 'function' &&
              typeof storeWrapper.destroy === 'function' &&
              storeWrapper.get !== undefined &&
              storeWrapper.set !== undefined &&
              storeWrapper.destroy !== undefined
            ) {
              sessionOptions['store'] = storeWrapper;
              this.logger.log('Session store wrapper created and validated successfully');
            } else {
              this.logger.warn(
                'Session store wrapper validation failed. Using in-memory store instead.'
              );
            }
          }
        }
      } catch (storeError) {
        this.logger.warn(
          `Failed to create session store wrapper: ${storeError instanceof Error ? storeError.message : String(storeError)}. Using in-memory store instead.`
        );
        // Don't add store - Fastify will use in-memory store
      }
    } else {
      this.logger.log('No session store provided - using in-memory store');
    }

    // Use Reflect.apply to call method with proper 'this' binding - avoids ESLint unbound-method warning
    const methodName: keyof IFastifyFrameworkAdapter = 'registerSession';
    const method = adapter[methodName];
    if (typeof method !== 'function') {
      throw new Error('registerSession is not a function');
    }

    // Log session options for debugging (without sensitive data)
    this.logger.log(
      `Registering Fastify session plugin with options: ${JSON.stringify({
        hasStore: !!sessionOptions['store'],
        cookieName: sessionOptions['cookieName'],
        cookieSecure: (sessionOptions['cookie'] as { secure?: boolean })?.secure,
        cookieHttpOnly: (sessionOptions['cookie'] as { httpOnly?: boolean })?.httpOnly,
      })}`
    );

    // CRITICAL: Ensure store is completely removed if not valid
    // Fastify session plugin will fail if store exists but has undefined methods
    if (sessionOptions['store']) {
      const store = sessionOptions['store'] as {
        set?: unknown;
        get?: unknown;
        destroy?: unknown;
      };
      if (
        !store ||
        typeof store.set !== 'function' ||
        typeof store.get !== 'function' ||
        typeof store.destroy !== 'function'
      ) {
        this.logger.warn('Store in sessionOptions is invalid - removing it before registration');
        delete sessionOptions['store'];
      }
    }

    try {
      this.logger.log('About to call registerSession method...');
      await Reflect.apply(method, adapter, [app, sessionOptions]);
      this.logger.log('Fastify session plugin registered successfully');
    } catch (registerError) {
      const errorMessage =
        registerError instanceof Error ? registerError.message : String(registerError);
      const errorStack = registerError instanceof Error ? registerError.stack : undefined;

      this.logger.error(`Failed to register Fastify session plugin: ${errorMessage}`, errorStack);

      // Always try without store if registration fails
      if (sessionOptions['store']) {
        this.logger.warn(
          'Session store appears to be causing registration failure. Retrying without store...'
        );
        const optionsWithoutStore = { ...sessionOptions };
        delete optionsWithoutStore['store'];
        try {
          await Reflect.apply(method, adapter, [app, optionsWithoutStore]);
          this.logger.log('Fastify session plugin registered successfully without store');
        } catch (retryError) {
          this.logger.error(
            `Failed to register Fastify session plugin even without store: ${retryError instanceof Error ? retryError.message : String(retryError)}`
          );
          throw retryError;
        }
      } else {
        throw registerError;
      }
    }
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
