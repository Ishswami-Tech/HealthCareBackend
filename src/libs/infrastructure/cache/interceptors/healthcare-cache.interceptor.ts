import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, of, throwError } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { CacheService } from "../cache.service";
import {
  CACHE_KEY,
  CACHE_INVALIDATE_KEY,
  UnifiedCacheOptions,
  CacheInvalidationOptions,
} from "../decorators/cache.decorator";

@Injectable()
export class HealthcareCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HealthcareCacheInterceptor.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const cacheOptions = this.reflector.get<UnifiedCacheOptions>(
      CACHE_KEY,
      context.getHandler(),
    );
    const invalidationOptions = this.reflector.get<CacheInvalidationOptions>(
      CACHE_INVALIDATE_KEY,
      context.getHandler(),
    );

    // If no cache configuration, proceed normally
    if (!cacheOptions && !invalidationOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Record<string, any>>();
    const _response = context.switchToHttp().getResponse();

    // Handle cache read operations
    if (cacheOptions && request["method"] === "GET") {
      return this.handleCacheRead(context, next, cacheOptions);
    }

    // Handle cache invalidation operations
    if (
      invalidationOptions &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request["method"] as string)
    ) {
      return this.handleCacheInvalidation(context, next, invalidationOptions);
    }

    // Default behavior
    return next.handle();
  }

  private async handleCacheRead(
    context: ExecutionContext,
    next: CallHandler,
    options: UnifiedCacheOptions,
  ): Promise<Observable<any>> {
    try {
      const cacheKey = this.generateCacheKey(context, options);

      if (!cacheKey) {
        this.logger.debug(
          "Could not generate cache key, proceeding without cache",
        );
        return next.handle();
      }

      // Check if we should apply caching based on condition
      if (options.condition) {
        // We need to execute first to check condition with result
        return next.handle().pipe(
          tap((result) => {
            if (options.condition!(context, result)) {
              void this.setCacheValue(cacheKey, result, options, context);
            }
          }),
        );
      }

      // Check for existing cache
      const cachedResult = await this.getCachedValue(cacheKey, options);
      if (cachedResult !== null) {
        this.logger.debug(`Cache hit for healthcare key: ${cacheKey}`);
        return of(cachedResult);
      }

      // Cache miss - execute and cache the result
      return next.handle().pipe(
        tap((result) => {
          if (result !== null && result !== undefined) {
            void this.setCacheValue(cacheKey, result, options, context);
          }
        }),
        catchError((error) => {
          this.logger.error(
            `Error in healthcare cache operation for key ${cacheKey}:`,
            error,
          );
          return throwError(() => error);
        }),
      );
    } catch (error) {
      this.logger.error("Error in healthcare cache read handler:", error);
      return next.handle();
    }
  }

  private handleCacheInvalidation(
    context: ExecutionContext,
    next: CallHandler,
    options: CacheInvalidationOptions,
  ): Observable<any> {
    return next.handle().pipe(
      tap((result) => {
        try {
          // Check condition before invalidating
          if (options.condition && !options.condition(context, result, ...[])) {
            return;
          }

          void this.performCacheInvalidation(context, result, options);
        } catch (error) {
          this.logger.error("Error in cache invalidation:", error);
          // Don't throw error here to avoid affecting the main operation
        }
      }),
      catchError((error) => {
        // Even if the operation fails, we might want to invalidate cache
        // to prevent serving stale data
        void this.performCacheInvalidation(context, null, options).catch(
          (invalidationError) => {
            this.logger.error(
              "Error in error-case cache invalidation:",
              invalidationError,
            );
          },
        );
        return throwError(() => error);
      }),
    );
  }

  private generateCacheKey(
    context: ExecutionContext,
    options: UnifiedCacheOptions,
  ): string | null {
    try {
      const request = context.switchToHttp().getRequest<Record<string, any>>();

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
        let key = options.keyTemplate;
        const params = { ...request["params"], ...request["query"] };

        // Add user context
        if (request["user"]) {
          params.userId = (request["user"] as Record<string, any>)["id"];
          params.userRole = (request["user"] as Record<string, any>)["role"];
        }

        // Replace placeholders in template
        for (const [param, value] of Object.entries(params)) {
          const placeholder = `{${param}}`;
          key = key.replace(placeholder, String(value));
        }

        // Add clinic specificity if needed
        if (options.clinicSpecific && request["params"]?.["clinicId"]) {
          key = `clinic:${request["params"]["clinicId"] as string}:${key}`;
        }

        // Add method name for uniqueness
        const methodName = context.getHandler().name;
        key = `${key}:${methodName}`;

        return key;
      }

      // Generate default key based on route and parameters
      const route = (request["route"]?.path || request["url"]) as string;
      const paramsStr =
        Object.keys(request["params"] || {}).length > 0
          ? JSON.stringify(request["params"])
          : "";
      const queryStr =
        Object.keys(request["query"] || {}).length > 0
          ? JSON.stringify(request["query"])
          : "";

      return `healthcare:${route}:${paramsStr}:${queryStr}`;
    } catch (error) {
      this.logger.error("Error generating cache key:", error);
      return null;
    }
  }

  private async getCachedValue(
    cacheKey: string,
    options: UnifiedCacheOptions,
  ): Promise<unknown> {
    try {
      // Route to appropriate cache method based on healthcare data type
      if (options.patientSpecific) {
        // This would use the healthcare cache service with patient-specific logic
        // For now, we'll use the basic Redis cache
        return await this.cacheService.get(cacheKey);
      }

      if (options.emergencyData) {
        // Emergency data uses minimal caching
        const cached = await this.cacheService.get(cacheKey);
        // Double-check TTL for emergency data
        if (cached) {
          const ttl = await this.cacheService.ttl(cacheKey);
          if (ttl > (options.ttl || 300)) {
            // TTL too long for emergency data, invalidate
            await this.cacheService.del(cacheKey);
            return null;
          }
        }
        return cached;
      }

      // Standard cache retrieval
      const cachedValue = await this.cacheService.get(cacheKey);
      return cachedValue ? JSON.parse(cachedValue as string) : null;
    } catch (error) {
      this.logger.error(
        `Error retrieving cached value for key ${cacheKey}:`,
        error,
      );
      return null;
    }
  }

  private async setCacheValue(
    cacheKey: string,
    value: unknown,
    options: UnifiedCacheOptions,
    context: ExecutionContext,
  ): Promise<void> {
    try {
      const ttl = this.calculateTTL(options, context);
      const serializedValue = JSON.stringify(value);

      // Apply healthcare-specific caching logic
      if (options.containsPHI) {
        // PHI data gets additional security measures
        await this.cacheService.set(cacheKey, serializedValue, ttl);

        // Track PHI cache access for compliance
        await this.trackPHIAccess(cacheKey, context, "cache_set");
      } else if (options.emergencyData) {
        // Emergency data uses minimal TTL
        const emergencyTTL = Math.min(ttl, 300); // Max 5 minutes
        await this.cacheService.set(cacheKey, serializedValue, emergencyTTL);
      } else {
        // Standard caching with SWR support
        await this.cacheService.cache(cacheKey, () => Promise.resolve(value), {
          ttl,
          ...(options.compress !== undefined && { compress: options.compress }),
          ...(options.enableCompression !== undefined && {
            compress: options.enableCompression,
          }),
          priority: this.mapPriority(options.priority),
          enableSwr: options.enableSWR !== false,
          ...(options.staleTime !== undefined && {
            staleTime: options.staleTime,
          }),
          ...(options.tags !== undefined && { tags: options.tags }),
        });
      }

      this.logger.debug(
        `Healthcare data cached with key: ${cacheKey}, TTL: ${ttl}s`,
      );
    } catch (error) {
      this.logger.error(
        `Error caching healthcare data for key ${cacheKey}:`,
        error,
      );
    }
  }

  private async performCacheInvalidation(
    context: ExecutionContext,
    result: unknown,
    options: CacheInvalidationOptions,
  ): Promise<void> {
    try {
      const request = context.switchToHttp().getRequest<Record<string, any>>();

      // Execute custom invalidation logic if provided
      if (options.customInvalidation) {
        await options.customInvalidation(context, result, ...[]);
        return;
      }

      // Invalidate by patterns
      if (options.patterns?.length > 0) {
        for (const pattern of options.patterns) {
          let resolvedPattern = pattern;

          // Replace placeholders in pattern
          const params = { ...request["params"], ...request["body"] };
          for (const [param, value] of Object.entries(params)) {
            resolvedPattern = resolvedPattern.replace(
              `{${param}}`,
              String(value),
            );
          }

          await this.cacheService.invalidateCacheByPattern(resolvedPattern);
          this.logger.debug(`Invalidated cache pattern: ${resolvedPattern}`);
        }
      }

      // Invalidate by tags
      if (options.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await this.cacheService.invalidateCacheByTag(tag);
          this.logger.debug(`Invalidated cache tag: ${tag}`);
        }
      }

      // Healthcare-specific invalidations
      if (options.invalidatePatient && request["params"]?.["patientId"]) {
        await this.cacheService.invalidatePatientCache(
          request["params"]["patientId"] as string,
          request["params"]?.["clinicId"] as string | undefined,
        );
      }

      if (options.invalidateDoctor && request["params"]?.["doctorId"]) {
        await this.cacheService.invalidateDoctorCache(
          request["params"]["doctorId"] as string,
          request["params"]?.["clinicId"] as string | undefined,
        );
      }

      if (options.invalidateClinic && request["params"]?.["clinicId"]) {
        await this.cacheService.invalidateClinicCache(
          request["params"]["clinicId"] as string,
        );
      }
    } catch (error) {
      this.logger.error("Error performing cache invalidation:", error);
      throw error;
    }
  }

  private calculateTTL(
    options: UnifiedCacheOptions,
    _context: ExecutionContext,
  ): number {
    if (options.ttl) {
      return options.ttl;
    }

    // Healthcare-specific TTL defaults
    if (options.emergencyData) return 300; // 5 minutes
    if (options.containsPHI) return 1800; // 30 minutes
    if (options.patientSpecific) return 3600; // 1 hour
    if (options.doctorSpecific) return 7200; // 2 hours
    if (options.clinicSpecific) return 14400; // 4 hours

    // Compliance-based TTL
    switch (options.complianceLevel) {
      case "restricted":
        return 900; // 15 minutes
      case "sensitive":
        return 1800; // 30 minutes
      case "standard":
        return 3600; // 1 hour
      default:
        return 3600;
    }
  }

  private mapPriority(priority?: string): "high" | "low" {
    switch (priority) {
      case "critical":
      case "high":
        return "high";
      case "normal":
      case "low":
      default:
        return "high"; // Healthcare data defaults to high priority
    }
  }

  private async trackPHIAccess(
    cacheKey: string,
    context: ExecutionContext,
    operation: "cache_get" | "cache_set",
  ): Promise<void> {
    try {
      const request = context.switchToHttp().getRequest<Record<string, any>>();
      const auditData = {
        timestamp: new Date().toISOString(),
        operation,
        cacheKey,
        userId: (request["user"] as Record<string, any>)?.["id"],
        userRole: (request["user"] as Record<string, any>)?.["role"],
        ipAddress: request["ip"] as string,
        userAgent: request["headers"]["user-agent"] as string,
        clinicId: (request["params"]?.["clinicId"] ||
          request["body"]?.["clinicId"]) as string,
      };

      // Log PHI access for compliance
      await this.cacheService.rPush(
        "phi:access:audit",
        JSON.stringify(auditData),
      );

      // Note: Audit log trimming would be handled by cache service internally
    } catch (error) {
      this.logger.error("Error tracking PHI access:", error);
    }
  }

  /**
   * Check if current request should bypass cache based on various factors
   */
  private shouldBypassCache(
    context: ExecutionContext,
    options: UnifiedCacheOptions,
  ): boolean {
    const request = context.switchToHttp().getRequest<Record<string, any>>();

    // Always bypass cache for emergency users when dealing with patient data
    if (
      options.patientSpecific &&
      (request["user"] as Record<string, any>)?.["role"] ===
        "EMERGENCY_RESPONDER"
    ) {
      return true;
    }

    // Bypass cache if force refresh header is present
    if (request["headers"]["x-force-refresh"] === "true") {
      return true;
    }

    // Bypass cache for emergency data during off-hours
    if (options.emergencyData) {
      const hour = new Date().getHours();
      if (hour < 6 || hour > 22) {
        // 6 AM to 10 PM
        return true;
      }
    }

    return false;
  }
}
