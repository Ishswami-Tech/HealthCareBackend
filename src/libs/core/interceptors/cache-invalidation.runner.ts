/**
 * Runs the invalidation a successful write asked for (`@InvalidateCache`).
 *
 * Order matters: TAGS first (the deterministic path, one indexed delete per tag), awaited within a
 * time budget so a read right after the write sees fresh data; then the PATTERN deletes, which
 * scan the keyspace and therefore run behind the response, scoped to what the caller may touch
 * (see planInvalidationPatterns), one at a time per pattern.
 *
 * Nothing here ever throws into the request: failures are logged.
 */

import type { ExecutionContext } from '@nestjs/common';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, type CacheInvalidationOptions } from '@core/types';
import { escapeGlobLiteral } from '@infrastructure/cache/utils/pattern-delete.util';
import {
  asNonEmptyString,
  buildTemplateParams,
  resolveActorScope,
  resolvePlaceholders,
  resolveTagTemplates,
  type ScopedRequest,
} from '@core/interceptors/cache-key-scope.util';
import {
  planInvalidationPatterns,
  routeClinicId,
  type InvalidationTenant,
  type RefusedPattern,
} from '@core/interceptors/cache-invalidation-scope.util';

const COMPONENT = 'HealthcareCacheInterceptor';
/** How long a write waits for its TAG invalidation before answering anyway (it keeps running). */
export const TAG_INVALIDATION_BUDGET_MS = 750;
/** Bound on remembered refusal log keys, so a hostile pattern list cannot grow memory. */
const MAX_LOGGED_REFUSALS = 500;

export class CacheInvalidationRunner {
  /**
   * Pattern deletes run at most one at a time per pattern (the pattern already carries the
   * clinic), with a trailing re-run for writes that arrive while one is in flight.
   */
  private readonly background = new KeyedJobCoalescer((key, error) => {
    void this.loggingService?.log(
      LogType.ERROR,
      LogLevel.ERROR,
      'Background cache invalidation failed',
      COMPONENT,
      { job: key, error: error.message, stack: error.stack }
    );
  });
  private readonly loggedRefusals = new Set<string>();

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  async run(
    context: ExecutionContext,
    result: unknown,
    options: CacheInvalidationOptions
  ): Promise<void> {
    if (!this.cacheService) {
      void this.loggingService?.log(
        LogType.CACHE,
        LogLevel.WARN,
        'Cache service not available, skipping cache invalidation',
        COMPONENT,
        {}
      );
      return;
    }

    // Execute custom invalidation logic if provided
    if (options.customInvalidation) {
      await options.customInvalidation(context, result, ...[]);
      return;
    }

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    await this.invalidateTags(request, options.tags);
    this.schedulePatterns(context, request, options.patterns);
    this.scheduleEntityInvalidations(request, options);
  }

  /**
   * Tags resolved exactly like the tags registered on reads, de-duplicated, invalidated in
   * parallel. Waits for them within TAG_INVALIDATION_BUDGET_MS; anything slower keeps running.
   */
  private async invalidateTags(
    request: ScopedRequest,
    tags: readonly string[] | undefined
  ): Promise<void> {
    const resolved = [...new Set(resolveTagTemplates(tags, request, true))];
    if (resolved.length === 0) return;

    const work = Promise.all(resolved.map(tag => this.invalidateOneTag(tag))).then(
      (): void => undefined
    );
    if (!(await settledWithin(work, TAG_INVALIDATION_BUDGET_MS))) {
      void this.loggingService?.log(
        LogType.CACHE,
        LogLevel.WARN,
        'Cache tag invalidation exceeded its wait budget; continuing in the background',
        COMPONENT,
        { tags: resolved, budgetMs: TAG_INVALIDATION_BUDGET_MS }
      );
    }
  }

  private async invalidateOneTag(tag: string): Promise<void> {
    try {
      await this.cacheService.invalidateCacheByTag(tag);
      await this.loggingService?.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Invalidated cache tag',
        COMPONENT,
        { tag }
      );
    } catch (error) {
      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to invalidate cache tag',
        COMPONENT,
        { tag, error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  }

  /**
   * Resolves every `{placeholder}` with the same rules as keys and tags (values are encoded and
   * glob-escaped, so a crafted id cannot widen the pattern), reduces the patterns to what this
   * caller may touch and schedules the survivors.
   */
  private schedulePatterns(
    context: ExecutionContext,
    request: ScopedRequest,
    patterns: readonly string[] | undefined
  ): void {
    if (!patterns || patterns.length === 0) return;
    const params = buildTemplateParams(request, true);
    const resolved = patterns.map(template =>
      resolvePlaceholders(template, params, escapeGlobLiteral)
    );
    const plan = planInvalidationPatterns(resolved, this.resolveTenant(request));

    plan.refused.forEach(refused => this.logRefusedPattern(context, refused));
    for (const pattern of plan.accepted) {
      this.background.schedule(`pattern:${pattern}`, () => this.invalidateOnePattern(pattern));
    }
  }

  private async invalidateOnePattern(pattern: string): Promise<void> {
    await this.cacheService.invalidateCacheByPattern(pattern);
    await this.loggingService?.log(
      LogType.CACHE,
      LogLevel.DEBUG,
      'Invalidated cache pattern',
      COMPONENT,
      { pattern }
    );
  }

  /** The validated clinic, or on controllers without ClinicGuard the (already authorised) route clinic. */
  private resolveTenant(request: ScopedRequest): InvalidationTenant {
    return { clinicId: resolveActorScope(request).clinicId ?? routeClinicId(request.params) };
  }

  private logRefusedPattern(context: ExecutionContext, refused: RefusedPattern): void {
    const handler = context.getHandler().name;
    const logKey = `${handler}|${refused.reason}|${refused.pattern}`;
    if (this.loggedRefusals.has(logKey)) return;
    if (this.loggedRefusals.size >= MAX_LOGGED_REFUSALS) this.loggedRefusals.clear();
    this.loggedRefusals.add(logKey);
    void this.loggingService?.log(
      refused.reason === 'no-tenant-context' ? LogType.CACHE : LogType.SECURITY,
      LogLevel.WARN,
      `Refused cache invalidation pattern (${refused.reason}); fix the @InvalidateCache declaration`,
      COMPONENT,
      { pattern: refused.pattern, reason: refused.reason, handler }
    );
  }

  /**
   * `invalidatePatient` / `invalidateDoctor` / `invalidateClinic` take their ids from the route.
   * They only run for the caller's clinic: a route clinic that differs from the validated one is
   * refused. They are heavy (several pattern deletes), so they run behind the response.
   */
  private scheduleEntityInvalidations(
    request: ScopedRequest,
    options: CacheInvalidationOptions
  ): void {
    if (!options.invalidatePatient && !options.invalidateDoctor && !options.invalidateClinic) {
      return;
    }
    const routeClinic = routeClinicId(request.params);
    const validatedClinic = resolveActorScope(request).clinicId;
    if (validatedClinic && routeClinic && validatedClinic !== routeClinic) {
      void this.loggingService?.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Refused entity cache invalidation: route clinic differs from the validated clinic',
        COMPONENT,
        { routeClinic, validatedClinic }
      );
      return;
    }
    const clinicId = validatedClinic ?? routeClinic;
    const patientId = asNonEmptyString(request.params?.['patientId']);
    const doctorId = asNonEmptyString(request.params?.['doctorId']);

    if (options.invalidatePatient && patientId) {
      this.background.schedule(`patient:${clinicId ?? ''}:${patientId}`, async () => {
        await this.cacheService.invalidatePatientCache(patientId, clinicId);
      });
    }
    if (options.invalidateDoctor && doctorId) {
      this.background.schedule(`doctor:${clinicId ?? ''}:${doctorId}`, async () => {
        await this.cacheService.invalidateDoctorCache(doctorId, clinicId);
      });
    }
    if (options.invalidateClinic && routeClinic) {
      this.background.schedule(`clinic:${routeClinic}`, async () => {
        await this.cacheService.invalidateClinicCache(routeClinic);
      });
    }
  }
}

/**
 * Small helpers that keep cache invalidation off the response's critical path without letting it
 * pile up.
 */

/**
 * Runs at most ONE job per key at a time. A job requested while one with the same key is still
 * running does not start a second concurrent run; it makes the running job go once more when it
 * finishes. So ten writes in a burst cost at most two scans per pattern, and every write is still
 * followed by a run that started after it.
 *
 * Failures never escape: they are reported to `onFailure` and the key is released.
 */
export class KeyedJobCoalescer {
  private readonly active = new Map<string, { rerun: boolean }>();

  constructor(private readonly onFailure: (key: string, error: Error) => void) {}

  /** Number of keys with a job currently running. */
  get inFlight(): number {
    return this.active.size;
  }

  schedule(key: string, job: () => Promise<void>): void {
    const running = this.active.get(key);
    if (running) {
      running.rerun = true;
      return;
    }
    const state = { rerun: false };
    this.active.set(key, state);
    void this.runUntilQuiet(key, state, job);
  }

  private async runUntilQuiet(
    key: string,
    state: { rerun: boolean },
    job: () => Promise<void>
  ): Promise<void> {
    try {
      do {
        state.rerun = false;
        await job();
      } while (state.rerun);
    } catch (error) {
      this.onFailure(key, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.active.delete(key);
    }
  }
}

/**
 * Resolves `true` when `work` settled within `budgetMs`, `false` when the budget ran out first
 * (the work keeps running). `work` must not reject.
 */
export async function settledWithin(work: Promise<void>, budgetMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), budgetMs);
    timer.unref();
  });
  try {
    return await Promise.race([work.then(() => true), budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
