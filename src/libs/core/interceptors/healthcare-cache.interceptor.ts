import { nowIso } from '@utils/date-time.util';
// External imports
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, of, throwError } from 'rxjs';
import { tap, catchError, concatMap, map } from 'rxjs/operators';

// Internal imports - Infrastructure
import { CacheService } from '@infrastructure/cache/cache.service';
import {
  encryptPHIValue,
  decryptPHIValue,
  getMissingEncryptionKeyWarningOnce,
} from '@infrastructure/cache/utils/phi-encryption.util';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

// Internal imports - Types
import type { UnifiedCacheOptions, CacheInvalidationOptions } from '@core/types';
import type { CustomFastifyRequest } from '@core/types/infrastructure.types';

// Internal imports - Core
import { CACHE_KEY, CACHE_INVALIDATE_KEY } from '@core/decorators';
import {
  asNonEmptyString,
  buildTemplateParams,
  clinicKeyPrefix,
  hashQuery,
  isCacheableQuery,
  resolveActorKeySegment,
  resolveActorScope,
  resolvePlaceholders,
  resolveTagTemplates,
  stripCacheBusterParams,
  withoutCacheBusters,
} from '@core/interceptors/cache-key-scope.util';
import type { ScopedRequest } from '@core/interceptors/cache-key-scope.util';
import { CacheInvalidationRunner } from '@core/interceptors/cache-invalidation.runner';
import {
  calculateTTL,
  isCachedEmptyArray,
  mapPriority,
  unwrapCacheValue,
} from '@core/interceptors/cache-value.util';

const HTTP_ERROR_STATUS_FLOOR = 400;
const HTTP_SERVER_ERROR_STATUS_FLOOR = 500;

@Injectable()
export class HealthcareCacheInterceptor implements NestInterceptor {
  /** Tag invalidation (awaited, bounded) and scoped, coalesced background pattern deletes. */
  private readonly invalidationRunner: CacheInvalidationRunner;

  constructor(
    @Inject(forwardRef(() => CacheService)) private readonly cacheService: CacheService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService
  ) {
    this.invalidationRunner = new CacheInvalidationRunner(cacheService, loggingService);
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      // Safely get cache options from reflector
      const cacheOptions = this.reflector?.get<UnifiedCacheOptions>(
        CACHE_KEY,
        context.getHandler()
      );
      const invalidationOptions = this.reflector?.get<CacheInvalidationOptions>(
        CACHE_INVALIDATE_KEY,
        context.getHandler()
      );

      // If no cache configuration, proceed normally
      if (!cacheOptions && !invalidationOptions) {
        return next.handle();
      }

      const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
      const _response = context.switchToHttp().getResponse<{ statusCode?: number }>();

      // ✅ Cache bust: clients can force a fresh fetch by sending
      // `?bust=1` or `X-Cache-Bust: 1`. Useful for the doctors list where
      // an empty cached result should be re-fetched.
      const hasBustQuery = (() => {
        const raw = (request as { query?: Record<string, unknown> })?.query;
        if (!raw) return false;
        const v = raw['bust'] ?? raw['cacheBust'] ?? raw['cache-bust'];
        return v === '1' || v === 'true';
      })();
      const bustHeader = (request.headers?.['x-cache-bust'] ?? '').toString().toLowerCase();
      const hasBustHeader = bustHeader === '1' || bustHeader === 'true';
      const shouldBustCache = hasBustQuery || hasBustHeader;

      // Handle cache read operations
      if (cacheOptions && request.method === 'GET' && !shouldBustCache) {
        return this.handleCacheRead(context, next, cacheOptions);
      }

      // Handle cache invalidation operations
      if (invalidationOptions && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        return this.handleCacheInvalidation(context, next, invalidationOptions);
      }

      // Default behavior
      return next.handle();
    } catch (error) {
      // If interceptor fails, log and proceed without caching
      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error in cache interceptor, proceeding without cache',
        'HealthcareCacheInterceptor',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return next.handle();
    }
  }

  private async handleCacheRead(
    context: ExecutionContext,
    next: CallHandler,
    options: UnifiedCacheOptions
  ): Promise<Observable<unknown>> {
    try {
      const cacheKey = this.generateCacheKey(context, options);

      if (!cacheKey) {
        await this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Could not generate cache key, proceeding without cache',
          'HealthcareCacheInterceptor',
          {}
        );
        return next.handle();
      }

      // Check if we should apply caching based on condition
      if (options.condition) {
        // We need to execute first to check condition with result
        return next.handle().pipe(
          tap(result => {
            if (options.condition!(context, result)) {
              void this.setCacheValue(cacheKey, result, options, context);
            }
          })
        );
      }

      // Check for existing cache
      const cachedResult = await this.getCachedValue(cacheKey, options);
      const cachedIsEmptyArray = isCachedEmptyArray(cachedResult);
      if (cachedResult !== null && !cachedIsEmptyArray) {
        await this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Cache hit for healthcare key',
          'HealthcareCacheInterceptor',
          { cacheKey }
        );
        return of(cachedResult);
      }

      // Stale empty array in cache — evict it and fall through to a fresh fetch.
      if (cachedResult !== null && cachedIsEmptyArray) {
        await this.cacheService.del(cacheKey).catch(() => {});
      }

      // Cache miss - execute and cache the result
      return next.handle().pipe(
        tap(result => {
          if (result !== null && result !== undefined) {
            void this.setCacheValue(cacheKey, result, options, context);
          }
        }),
        catchError(error => {
          // A handler's own HttpException (403, 404, validation, ...) is a normal response
          // passing through, not a cache failure. Only real backend failures are logged here.
          if (
            !(error instanceof HttpException) ||
            error.getStatus() >= HTTP_SERVER_ERROR_STATUS_FLOOR
          ) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              'Error in healthcare cache operation',
              'HealthcareCacheInterceptor',
              {
                cacheKey,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
              }
            );
          }
          return throwError(() => error as Error);
        })
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error in healthcare cache read handler',
        'HealthcareCacheInterceptor',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      // Fail gracefully - return next handler instead of throwing
      return next.handle();
    }
  }

  /**
   * Invalidation runs only AFTER the handler succeeded: a failed write (any thrown error, so 4xx
   * and 5xx alike) changed nothing and must not be a way to flush other people's cache, and an
   * invalid body must not cost a keyspace scan. The error passes through untouched.
   */
  private handleCacheInvalidation(
    context: ExecutionContext,
    next: CallHandler,
    options: CacheInvalidationOptions
  ): Observable<unknown> {
    return next
      .handle()
      .pipe(
        concatMap((result: unknown) =>
          from(this.invalidateAfterSuccess(context, result, options)).pipe(map(() => result))
        )
      );
  }

  private async invalidateAfterSuccess(
    context: ExecutionContext,
    result: unknown,
    options: CacheInvalidationOptions
  ): Promise<void> {
    try {
      const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
      if ((response?.statusCode ?? 200) >= HTTP_ERROR_STATUS_FLOOR) return;
      if (options.condition && !options.condition(context, result, ...[])) return;
      await this.invalidationRunner.run(context, result, options);
    } catch (error) {
      // Never let invalidation affect the response of the write that already succeeded.
      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error in cache invalidation',
        'HealthcareCacheInterceptor',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Clinic that scopes a templated key. The validated clinic always wins; the
   * legacy `clinicSpecific` + route-param behaviour only applies when the
   * request carries no clinic context (e.g. a global SUPER_ADMIN call).
   */
  private resolveKeyClinicId(
    request: ScopedRequest,
    options: UnifiedCacheOptions
  ): string | undefined {
    const { clinicId } = resolveActorScope(request);
    if (clinicId) return clinicId;
    return options.clinicSpecific ? asNonEmptyString(request.params?.['clinicId']) : undefined;
  }

  /**
   * Final key:
   * `[clinic:<clinicId>:]<resolved template>:<handler>[:<actor segment>]:q-<query digest>`
   * (32 hex characters; cache-buster params are ignored; a query over the size limits is not
   * cached at all, see isCacheableQuery).
   *
   * Every templated key is clinic-scoped whenever the request has a clinic
   * context, even if the template forgot `{clinicId}`, so two clinics can never
   * share an entry. The actor segment (`u-<userId>` for a PATIENT, `r-<ROLE>`
   * for staff, see resolveActorKeySegment) keeps one caller's response from
   * being replayed to another caller whose ownership/role check would be
   * skipped on a hit. The query digest keeps filters (?status=, ?page=, ...)
   * distinct now that the query can no longer supply identity placeholders; it
   * only ever makes a key more specific. Tags never receive the segment or digest.
   */
  private finalizeTemplateKey(
    resolvedKey: string,
    request: ScopedRequest,
    options: UnifiedCacheOptions,
    context: ExecutionContext,
    params: Readonly<Record<string, unknown>>
  ): string {
    const clinicId = this.resolveKeyClinicId(request, options);
    const scopedKey = clinicId ? `${clinicKeyPrefix(clinicId)}${resolvedKey}` : resolvedKey;
    const actorSegment = resolveActorKeySegment(
      options.keyTemplate ?? '',
      params,
      resolveActorScope(request)
    );
    const handlerAndActor = actorSegment
      ? `${context.getHandler().name}:${actorSegment}`
      : context.getHandler().name;
    return `${scopedKey}:${handlerAndActor}:q-${hashQuery(request.query)}`;
  }

  /**
   * Key for routes without a keyTemplate. The URL alone does not identify the
   * caller (personal endpoints such as /me answer differently per user), so the
   * validated clinic and the authenticated user are part of the key.
   */
  private buildDefaultKey(request: ScopedRequest): string | null {
    if (!isCacheableQuery(request.query)) return null;
    const { clinicId, userId } = resolveActorScope(request);
    const scope = (clinicId ? `clinic:${clinicId}:` : '') + (userId ? `user:${userId}:` : '');
    // Cache-buster params (?_t=<now>) never change the response; keep them out of the key.
    const route = stripCacheBusterParams(request.url || '');
    const paramsStr =
      request.params && Object.keys(request.params).length > 0
        ? JSON.stringify(request.params)
        : '';
    const relevantQuery = withoutCacheBusters(request.query);
    const queryStr = Object.keys(relevantQuery).length > 0 ? JSON.stringify(relevantQuery) : '';

    return `healthcare:${scope}${route}:${paramsStr}:${queryStr}`;
  }

  /**
   * Cache tags with `{placeholder}`s resolved the same way as the key
   * template (so `user:{userId}` becomes `user:<id>`). Used for every write
   * path so that invalidateCacheByTag() reaches PHI/emergency entries too.
   * The write path resolves the same tags through the shared resolveTagTemplates.
   */
  private resolveTags(options: UnifiedCacheOptions, context: ExecutionContext): string[] {
    return resolveTagTemplates(
      options.tags,
      context.switchToHttp().getRequest<ScopedRequest>(),
      false
    );
  }

  private generateCacheKey(context: ExecutionContext, options: UnifiedCacheOptions): string | null {
    try {
      const request = context.switchToHttp().getRequest<ScopedRequest>();

      // Use custom key generator if provided
      if (options.customKeyGenerator) {
        return options.customKeyGenerator(context, ...[]);
      }

      // Use legacy keyGenerator for backward compatibility
      if (options.keyGenerator) {
        return options.keyGenerator(...[]);
      }

      // Use key template with parameter substitution
      if (options.keyTemplate) {
        // Over-limit queries are not cached: truncating would alias different filters, and an
        // unbounded query space lets `?x=<random>` flood the cache with one-hit entries.
        if (!isCacheableQuery(request.query)) return null;
        const params = buildTemplateParams(request);
        const key = resolvePlaceholders(options.keyTemplate, params);
        return this.finalizeTemplateKey(key, request, options, context, params);
      }

      // Generate default key based on route, parameters, clinic and caller
      return this.buildDefaultKey(request);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error generating cache key',
        'HealthcareCacheInterceptor',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  private async getCachedValue(cacheKey: string, options: UnifiedCacheOptions): Promise<unknown> {
    try {
      // Check if cache service is available
      if (!this.cacheService) {
        void this.loggingService?.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache service not available, skipping cache retrieval',
          'HealthcareCacheInterceptor',
          { cacheKey }
        );
        return null;
      }

      // Safely call cache service methods with error handling
      try {
        // Route to appropriate cache method based on healthcare data type
        if (options.patientSpecific) {
          const raw = await this.cacheService.get(cacheKey);
          return decryptPHIValue(raw);
        }

        if (options.emergencyData) {
          const cached = await this.cacheService.get(cacheKey);
          if (cached) {
            const ttl = await this.cacheService.ttl(cacheKey);
            if (ttl > (options.ttl || 300)) {
              await this.cacheService.del(cacheKey);
              return null;
            }
          }
          return cached;
        }

        // Standard cache retrieval — unwrap SWR wrapper if present.
        // The cache strategies store data as { data: T, timestamp: number }
        // but the interceptor reads directly from the provider, so we need
        // to unwrap here to return the actual data to the client.
        // decryptPHIValue is a no-op passthrough for non-encrypted values
        // (needed here too since @Cache({containsPHI:true}) without
        // patientSpecific writes via the encrypted branch above but reads
        // via this branch, not the patientSpecific one).
        const cachedValue = await this.cacheService.get(cacheKey);
        const decrypted = decryptPHIValue(cachedValue);
        return unwrapCacheValue(decrypted) ?? null;
      } catch (cacheError) {
        void this.loggingService?.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache service error during retrieval, proceeding without cache',
          'HealthcareCacheInterceptor',
          {
            cacheKey,
            error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          }
        );
        return null;
      }
    } catch (error) {
      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error retrieving cached value',
        'HealthcareCacheInterceptor',
        {
          cacheKey,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  private async setCacheValue(
    cacheKey: string,
    value: unknown,
    options: UnifiedCacheOptions,
    context: ExecutionContext
  ): Promise<void> {
    try {
      // Empty arrays are often transient (e.g. race with doctor/location
      // assignment), so don't cache them at the normal TTL — but a genuinely
      // empty steady-state list (e.g. a patient with zero appointments) is
      // common and would otherwise never get a cache hit. Cache empty
      // results briefly instead of skipping entirely.
      const isEmptyArrayResult = Array.isArray(value) && value.length === 0;
      const effectiveOptions: UnifiedCacheOptions = isEmptyArrayResult
        ? { ...options, ttl: Math.min(options.ttl ?? 30, 30) }
        : options;

      // Check if cache service is available
      if (!this.cacheService) {
        void this.loggingService?.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache service not available, skipping cache set',
          'HealthcareCacheInterceptor',
          { cacheKey }
        );
        return;
      }

      // Safely call cache service methods with error handling
      try {
        const ttl = calculateTTL(effectiveOptions);
        const serializedValue = JSON.stringify(value);

        // Apply healthcare-specific caching logic
        const cacheTTL = effectiveOptions.ttl ?? 1800;
        // Tags are registered for the set() paths too; otherwise writes that
        // call invalidateCacheByTag() never reach PHI/emergency entries and a
        // create followed by a list read returns the pre-create data.
        const tags = this.resolveTags(effectiveOptions, context);
        if (effectiveOptions.containsPHI) {
          // PHI data gets additional security measures — encrypted at rest,
          // not stored as plaintext JSON like the other branches.
          const missingKeyWarning = getMissingEncryptionKeyWarningOnce();
          if (missingKeyWarning) {
            void this.loggingService?.log(
              LogType.SECURITY,
              LogLevel.ERROR,
              missingKeyWarning,
              'HealthcareCacheInterceptor'
            );
          }
          const encryptedValue = encryptPHIValue(value);
          await this.cacheService.set(cacheKey, encryptedValue, { ttl: cacheTTL, tags });

          // Track PHI cache access for compliance (fire-and-forget: audit
          // logging must not add latency to the request's critical path;
          // trackPHIAccess handles its own errors internally).
          void this.trackPHIAccess(cacheKey, context, 'cache_set');
        } else if (effectiveOptions.emergencyData) {
          // Emergency data uses minimal TTL
          const emergencyTTL = Math.min(ttl, 300); // Max 5 minutes
          await this.cacheService.set(cacheKey, serializedValue, { ttl: emergencyTTL, tags });
        } else {
          // Standard caching with SWR support
          await this.cacheService.cache(cacheKey, () => Promise.resolve(value), {
            ttl,
            ...(effectiveOptions.compress !== undefined && { compress: effectiveOptions.compress }),
            ...(effectiveOptions.enableCompression !== undefined && {
              compress: effectiveOptions.enableCompression,
            }),
            priority: mapPriority(effectiveOptions.priority),
            enableSwr: effectiveOptions.enableSWR !== false,
            ...(effectiveOptions.staleTime !== undefined && {
              staleTime: effectiveOptions.staleTime,
            }),
            // Resolved like the tags on the set() paths above, so a
            // `user:{userId}` / `clinic:{clinicId}` tag matches the strings
            // services pass to invalidateCacheByTag().
            ...(effectiveOptions.tags !== undefined && { tags }),
          });
        }

        const ttlValue = effectiveOptions.ttl ?? 1800;
        await this.loggingService.log(
          LogType.CACHE,
          LogLevel.DEBUG,
          'Healthcare data cached',
          'HealthcareCacheInterceptor',
          { cacheKey, ttl: ttlValue }
        );
      } catch (cacheError) {
        // Cache service might not be fully initialized yet
        void this.loggingService?.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Cache service error during set, proceeding without cache',
          'HealthcareCacheInterceptor',
          {
            cacheKey,
            error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
          }
        );
        // Don't throw - allow request to proceed without caching
      }
    } catch (error) {
      const ttlValueForError = options.ttl ?? 1800;
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error caching healthcare data',
        'HealthcareCacheInterceptor',
        {
          cacheKey,
          ttl: ttlValueForError,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  private async trackPHIAccess(
    cacheKey: string,
    context: ExecutionContext,
    operation: 'cache_get' | 'cache_set'
  ): Promise<void> {
    try {
      const request = context.switchToHttp().getRequest<ScopedRequest>();
      const auditData = {
        timestamp: nowIso(),
        operation,
        cacheKey,
        userId: request.user?.sub,
        userRole: request.user?.role,
        ipAddress: request.ip || '',
        userAgent: request.headers['user-agent'] || '',
        // The guard-validated clinic is the authoritative one for the audit trail.
        clinicId:
          resolveActorScope(request).clinicId ||
          (request.params?.['clinicId'] as string) ||
          ((request.body as Record<string, unknown>)?.['clinicId'] as string) ||
          '',
      };

      // Log PHI access for compliance
      await this.cacheService.rPush('phi:access:audit', JSON.stringify(auditData));

      // Note: Audit log trimming would be handled by cache service internally
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error tracking PHI access',
        'HealthcareCacheInterceptor',
        {
          cacheKey,
          operation,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }
}
