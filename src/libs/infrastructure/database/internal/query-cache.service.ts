/**
 * Query Cache Service
 * @class QueryCacheService
 * @description Caches database query results for improved performance
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
// Use direct imports to avoid TDZ issues with barrel exports
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import type { PrismaArgValue } from '@infrastructure/database/internal/query-dependency-tracker';

/** JSON as it is stored in L2 (Dragonfly stores JSON.stringify output). */
export type CacheJson =
  string | number | boolean | null | CacheJson[] | { [key: string]: CacheJson };

/**
 * Type-preserving encoding for query results.
 *
 * L2 stores JSON, so a cached Prisma result used to come back from Dragonfly with every
 * DateTime as an ISO string (426 DateTime fields in the schema) and a BigInt made the write
 * throw. Code that checks `instanceof Date` or calls date methods then failed on L2 hits only
 * (PermissionService: "Invalid permission entity structure", seen in production once the
 * query cache started serving L2 hits). Values are encoded into tagged JSON before caching and
 * decoded on every read, so a hit returns the same types the query returned, from either layer.
 *
 * A plain object that itself has a `__hcbType` key (e.g. inside a Json column) is escaped as
 * `{ __hcbType: 'Object', v: ... }`, so decoding never misreads user data as a tag.
 */
const TYPE_KEY = '__hcbType';
/** Envelope marker; an entry without it (written before this encoding) is treated as a miss. */
const ENVELOPE_KEY = '__hcbQueryCache';
const ENVELOPE_VERSION = 1;

interface QueryCacheEnvelope {
  [ENVELOPE_KEY]: number;
  v: CacheJson;
}

export function encodeQueryCacheValue(value: PrismaArgValue): CacheJson {
  if (value === null) return null;
  if (value === undefined) return { [TYPE_KEY]: 'Undefined' };
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { [TYPE_KEY]: 'Number', v: String(value) };
  }
  if (typeof value === 'bigint') return { [TYPE_KEY]: 'BigInt', v: value.toString() };
  if (value instanceof Date) {
    return { [TYPE_KEY]: 'Date', v: Number.isNaN(value.getTime()) ? null : value.toISOString() };
  }
  if (value instanceof Uint8Array) {
    return { [TYPE_KEY]: 'Bytes', v: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) {
    // Array.isArray narrows to any[]; keep the element type. undefined -> null, as JSON does.
    return (value as readonly PrismaArgValue[]).map(item =>
      item === undefined ? null : encodeQueryCacheValue(item)
    );
  }
  // Other class instances with toJSON (e.g. Decimal): their JSON form, as before.
  const withToJson = value as { toJSON?: () => PrismaArgValue };
  if (typeof withToJson.toJSON === 'function') return encodeQueryCacheValue(withToJson.toJSON());
  const entries: { [key: string]: CacheJson } = {};
  for (const [key, child] of Object.entries(value as Record<string, PrismaArgValue>)) {
    if (child !== undefined) entries[key] = encodeQueryCacheValue(child);
  }
  return TYPE_KEY in entries ? { [TYPE_KEY]: 'Object', v: entries } : entries;
}

export function decodeQueryCacheValue(value: CacheJson): PrismaArgValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => decodeQueryCacheValue(item));
  const tag = value[TYPE_KEY];
  if (typeof tag === 'string') {
    const payload: CacheJson | undefined = value['v'];
    const text = typeof payload === 'string' ? payload : null;
    switch (tag) {
      case 'Date':
        return text === null ? new Date(NaN) : new Date(text);
      case 'BigInt':
        if (text !== null) return BigInt(text);
        break;
      case 'Bytes':
        if (text !== null) return Buffer.from(text, 'base64');
        break;
      case 'Number':
        if (text !== null) return Number(text);
        break;
      case 'Undefined':
        return undefined;
      case 'Object':
        return decodeEntries(payload ?? {});
      default:
        break; // not one of ours: an ordinary object
    }
  }
  return decodeEntries(value);
}

function decodeEntries(value: CacheJson): { [key: string]: PrismaArgValue } {
  const out: { [key: string]: PrismaArgValue } = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) out[key] = decodeQueryCacheValue(child);
  return out;
}

function isQueryCacheEnvelope(value: PrismaArgValue): value is QueryCacheEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [ENVELOPE_KEY]?: PrismaArgValue })[ENVELOPE_KEY] === ENVELOPE_VERSION
  );
}

export interface QueryCacheOptions {
  ttl?: number;
  tags?: string[];
  containsPHI?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

/**
 * Query cache service
 * @internal
 */
@Injectable()
export class QueryCacheService {
  private readonly serviceName = 'QueryCacheService';
  private readonly defaultTTL = 300; // 5 minutes
  private readonly defaultPHITTL = 60; // 1 minute for PHI data

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Generate cache key for query
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  generateCacheKey(operation: string, params?: Record<string, unknown>): string {
    const paramsHash = params ? JSON.stringify(params) : '';
    const key = `db:query:${operation}:${paramsHash}`;
    return key;
  }

  /**
   * Get cached query result
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async getCached<T>(cacheKey: string): Promise<T | null> {
    try {
      const cached = await this.cacheService.get<PrismaArgValue>(cacheKey);
      // Only entries written in the type-preserving format are served; an older entry (its dates
      // already turned into strings) counts as a miss and is overwritten by the next fill.
      if (cached === null || !isQueryCacheEnvelope(cached)) return null;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Cache hit for query: ${cacheKey.substring(0, 100)}`,
        this.serviceName
      );
      // A fresh object per hit: callers can no longer mutate the copy held in L1.
      return decodeQueryCacheValue(cached.v) as T;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isBootstrapCacheInitIssue = errorMessage.includes(
        'providerFactory not initialized yet'
      );
      void this.loggingService.log(
        LogType.DATABASE,
        isBootstrapCacheInitIssue ? LogLevel.DEBUG : LogLevel.WARN,
        `Cache get failed: ${errorMessage}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
      return null;
    }
  }

  /**
   * Cache query result
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async setCached<T>(cacheKey: string, data: T, options: QueryCacheOptions = {}): Promise<void> {
    try {
      // PHI is capped at defaultPHITTL: executeRead passes its 300 s / 3600 s strategy TTL, which
      // used to override the PHI limit (hidden while every write emptied the query cache).
      const ttl = options.containsPHI
        ? Math.min(options.ttl ?? this.defaultPHITTL, this.defaultPHITTL)
        : (options.ttl ?? this.defaultTTL);

      // Use cache() method which accepts CacheOperationOptions.
      // enableSwr: false - getCached() reads with CacheService.get(), which returns the stored
      // value as-is, so the value must be stored as-is: the SWR strategy would store it wrapped
      // as { data, timestamp }. PHI results still go through the PHI strategy (encrypted, and
      // decrypted by get()).
      const envelope: QueryCacheEnvelope = {
        [ENVELOPE_KEY]: ENVELOPE_VERSION,
        v: encodeQueryCacheValue(data as PrismaArgValue),
      };
      await this.cacheService.cache(cacheKey, () => Promise.resolve(envelope), {
        ttl,
        tags: options.tags ?? ['database', 'query'],
        priority: options.priority ?? 'normal',
        containsPHI: options.containsPHI ?? false,
        enableSwr: false,
      });

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Cached query result: ${cacheKey.substring(0, 100)}`,
        this.serviceName,
        { ttl, containsPHI: options.containsPHI }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isBootstrapCacheInitIssue = errorMessage.includes(
        'providerFactory not initialized yet'
      );
      void this.loggingService.log(
        LogType.DATABASE,
        isBootstrapCacheInitIssue ? LogLevel.DEBUG : LogLevel.WARN,
        `Cache set failed: ${errorMessage}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }
  }

  /**
   * Invalidate query cache
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  async invalidateCache(pattern?: string, tags?: string[]): Promise<void> {
    try {
      if (pattern) {
        await this.cacheService.invalidateByPattern(pattern);
      }
      if (tags && tags.length > 0) {
        // Invalidate each tag individually
        for (const tag of tags) {
          await this.cacheService.invalidateCacheByTag(tag);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isBootstrapCacheInitIssue = errorMessage.includes(
        'providerFactory not initialized yet'
      );
      void this.loggingService.log(
        LogType.DATABASE,
        isBootstrapCacheInitIssue ? LogLevel.DEBUG : LogLevel.WARN,
        `Cache invalidation failed: ${errorMessage}`,
        this.serviceName,
        { error: error instanceof Error ? error.stack : String(error) }
      );
    }
  }
}
