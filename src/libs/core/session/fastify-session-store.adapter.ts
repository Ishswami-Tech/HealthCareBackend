/**
 * Fastify Session Store Adapter
 *
 * Adapter that implements @fastify/session store interface using CacheService
 * This allows Fastify sessions to use the existing cache infrastructure (Dragonfly/Redis)
 * via CacheService, which is provider-agnostic and works with any cache backend.
 *
 * @module FastifySessionStoreAdapter
 * @description CacheService-based store adapter for @fastify/session
 */

import { Injectable, Optional } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';

/**
 * Session store interface compatible with @fastify/session
 * Based on @fastify/session Store contract - uses callbacks as per Fastify specification
 * @see https://github.com/fastify/session#store
 */
export interface SessionStore {
  get(sid: string, callback: (err: unknown, result?: unknown) => void): void;
  set(sid: string, session: unknown, callback: (err?: unknown) => void): void;
  destroy(sid: string, callback: (err?: unknown) => void): void;
  touch?(sid: string, session: unknown, callback: (err?: unknown) => void): void;
}

/**
 * Fastify Session Store Adapter
 *
 * Implements @fastify/session store interface using CacheService
 * Uses CacheService for session storage, which works with Dragonfly, Redis, or any cache provider
 * configured via CACHE_PROVIDER environment variable.
 *
 * @class FastifySessionStoreAdapter
 * @implements {SessionStore}
 */
@Injectable()
export class FastifySessionStoreAdapter implements SessionStore {
  private readonly SESSION_PREFIX = 'fastify:session:';
  private readonly useCache: boolean;

  constructor(@Optional() private readonly cacheService?: CacheService) {
    this.useCache = cacheService !== undefined && cacheService !== null;

    // Bind methods to ensure 'this' context is preserved when called by Fastify
    // This is critical - Fastify session plugin may call these methods without proper context
    this.get = this.get.bind(this);
    this.set = this.set.bind(this);
    this.destroy = this.destroy.bind(this);
    this.touch = this.touch.bind(this);
  }

  /**
   * Get session data by session ID
   * Implements Fastify Store interface with callback pattern
   *
   * @param sid - Session identifier
   * @param callback - Callback function (err, result)
   */
  get(sid: string, callback: (err: unknown, result?: unknown) => void): void {
    // If cache is disabled, return null (session not found)
    if (!this.useCache || !this.cacheService) {
      callback(null, null);
      return;
    }

    const key = this.getSessionKey(sid);
    this.cacheService
      .get<unknown>(key)
      .then(session => {
        callback(null, session ?? null);
      })
      .catch(err => {
        callback(err);
      });
  }

  /**
   * Store session data with TTL
   * Implements Fastify Store interface with callback pattern
   *
   * @param sid - Session identifier
   * @param session - Session data to store
   * @param callback - Callback function (err)
   */
  set(sid: string, session: unknown, callback: (err?: unknown) => void): void {
    // If cache is disabled, just call callback (sessions will use in-memory store)
    if (!this.useCache || !this.cacheService) {
      callback();
      return;
    }

    const key = this.getSessionKey(sid);

    // Extract TTL from session if it has expiresAt property
    let ttl: number | undefined;
    if (session && typeof session === 'object' && 'expiresAt' in session) {
      const expiresAt = (session as { expiresAt?: Date | number }).expiresAt;
      if (expiresAt) {
        const expiresTime = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
        const now = Date.now();
        ttl = Math.max(0, Math.floor((expiresTime - now) / 1000));
      }
    }

    // Default TTL: 24 hours (86400 seconds)
    if (!ttl || ttl <= 0) {
      ttl = 86400;
    }

    this.cacheService
      .set(key, session, ttl)
      .then(() => {
        callback();
      })
      .catch(err => {
        callback(err);
      });
  }

  /**
   * Destroy/delete session
   * Implements Fastify Store interface with callback pattern
   *
   * @param sid - Session identifier
   * @param callback - Callback function (err)
   */
  destroy(sid: string, callback: (err?: unknown) => void): void {
    // If cache is disabled, just call callback
    if (!this.useCache || !this.cacheService) {
      callback();
      return;
    }

    const key = this.getSessionKey(sid);
    this.cacheService
      .del(key)
      .then(() => {
        callback();
      })
      .catch(err => {
        callback(err);
      });
  }

  /**
   * Touch/update session expiry (optional method)
   * Implements Fastify Store interface with callback pattern
   *
   * @param sid - Session identifier
   * @param session - Session data
   * @param callback - Callback function (err)
   */
  touch(sid: string, session: unknown, callback: (err?: unknown) => void): void {
    // Touch is essentially a set operation that updates the expiry
    // Use bound set method to ensure proper context
    this.set(sid, session, callback);
  }

  /**
   * Get cache key for session
   *
   * @param sessionId - Session identifier
   * @returns string - Cache key (works with Dragonfly, Redis, or any cache provider)
   */
  private getSessionKey(sessionId: string): string {
    return `${this.SESSION_PREFIX}${sessionId}`;
  }
}
