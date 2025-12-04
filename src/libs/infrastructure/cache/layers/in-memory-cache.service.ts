/**
 * In-Memory Cache Service (L1 Layer)
 * @class InMemoryCacheService
 * @description Fast in-process memory cache for frequently accessed data
 *
 * This is the first layer (L1) in the multi-layer cache architecture:
 * - L1: In-Memory (this service) - Fastest, process-local, limited size
 * - L2: Distributed Cache (Redis/Dragonfly) - Shared across instances
 * - L3: Database (PostgreSQL) - Persistent storage
 *
 * Features:
 * - LRU (Least Recently Used) eviction
 * - Memory-aware size limits
 * - Automatic expiration
 * - Thread-safe operations
 * - Configurable TTL
 *
 * @see https://docs.nestjs.com - NestJS patterns
 */

import { Injectable, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  value: T;
  expires: number;
  accessTime: number; // For LRU eviction
}

/**
 * In-memory cache service with LRU eviction
 */
@Injectable()
export class InMemoryCacheService implements OnModuleDestroy {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;
  private readonly maxMemoryMB: number;
  private readonly enableMetrics: boolean;
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Load configuration with defaults
    this.maxSize = this.configService.getEnvNumber('L1_CACHE_MAX_SIZE', 10000);
    this.defaultTTL = this.configService.getEnvNumber('L1_CACHE_DEFAULT_TTL', 30); // 30 seconds
    this.maxMemoryMB = this.configService.getEnvNumber('L1_CACHE_MAX_MEMORY_MB', 50); // 50MB limit
    this.enableMetrics = this.configService.getEnvBoolean('L1_CACHE_ENABLE_METRICS', true);

    // Start periodic cleanup (every 60 seconds)
    this.startCleanupInterval();
  }

  /**
   * Get value from cache
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      this.missCount++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    // Update access time for LRU
    entry.accessTime = Date.now();
    this.hitCount++;

    return entry.value as T;
  }

  /**
   * Set value in cache
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttl - Time to live in seconds (default: configured defaultTTL)
   */
  set<T>(key: string, value: T, ttl: number = this.defaultTTL): void {
    // Check memory limit and evict if necessary
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Check memory usage (rough estimate)
    const estimatedSize = this.estimateEntrySize(key, value);
    const currentMemoryMB = this.estimateTotalMemory();
    if (currentMemoryMB + estimatedSize > this.maxMemoryMB) {
      // Evict until we have space
      while (currentMemoryMB + estimatedSize > this.maxMemoryMB && this.cache.size > 0) {
        this.evictLRU();
      }
    }

    this.cache.set(key, {
      value,
      expires: Date.now() + ttl * 1000,
      accessTime: Date.now(),
    });
  }

  /**
   * Delete value from cache
   * @param key - Cache key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if key exists and is not expired
   * @param key - Cache key
   */
  exists(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitCount: number;
    missCount: number;
    hitRate: number;
    evictionCount: number;
    estimatedMemoryMB: number;
  } {
    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate,
      evictionCount: this.evictionCount,
      estimatedMemoryMB: this.estimateTotalMemory(),
    };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    if (this.cache.size === 0) {
      return;
    }

    // Find least recently used entry
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessTime < lruTime) {
        lruTime = entry.accessTime;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.evictionCount++;
    }
  }

  /**
   * Estimate size of a cache entry in MB
   */
  private estimateEntrySize(key: string, value: unknown): number {
    // Rough estimation: JSON stringify size
    try {
      const keySize = key.length * 2; // UTF-16 encoding
      const valueSize = JSON.stringify(value).length * 2;
      const overhead = 100; // Map entry overhead
      return (keySize + valueSize + overhead) / (1024 * 1024); // Convert to MB
    } catch {
      // If serialization fails, estimate conservatively
      return 0.001; // 1KB default
    }
  }

  /**
   * Estimate total memory usage in MB
   */
  private estimateTotalMemory(): number {
    let totalMB = 0;
    for (const [key, entry] of this.cache.entries()) {
      totalMB += this.estimateEntrySize(key, entry.value);
    }
    return totalMB;
  }

  /**
   * Start periodic cleanup interval
   */
  private startCleanupInterval(): void {
    // Cleanup expired entries every 60 seconds
    setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  /**
   * Remove expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0 && this.enableMetrics) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        `L1 cache cleanup: removed ${cleanedCount} expired entries`,
        'InMemoryCacheService',
        { cleanedCount, remainingSize: this.cache.size }
      );
    }
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    this.clear();
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'L1 in-memory cache service destroyed',
      'InMemoryCacheService',
      {}
    );
  }
}
