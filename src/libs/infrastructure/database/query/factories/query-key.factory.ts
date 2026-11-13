/**
 * Query Key Factory
 * @class QueryKeyFactory
 * @description Centralized query cache key generation (DRY principle)
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable } from '@nestjs/common';

/**
 * Query key factory implementation
 * Centralizes all query cache key generation logic to avoid duplication
 */
@Injectable()
export class QueryKeyFactory {
  private readonly KEY_SEPARATOR = ':';
  // v2: query results are stored as the value itself. Entries written before that were wrapped
  // by the SWR strategy as { data, timestamp } and read back unwrapped, so a cache hit returned
  // the wrapper; the new prefix makes those old entries unreachable until they expire.
  private readonly KEY_PREFIX = 'healthcare:query:v2';

  /**
   * Generate user-specific query cache key
   */
  user(userId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'user', userId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate patient-specific query cache key
   */
  patient(patientId: string, clinicId?: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'patient', patientId];
    if (clinicId) {
      parts.push('clinic', clinicId);
    }
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate doctor-specific query cache key
   */
  doctor(doctorId: string, clinicId?: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'doctor', doctorId];
    if (clinicId) {
      parts.push('clinic', clinicId);
    }
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate appointment-specific query cache key
   */
  appointment(appointmentId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'appointment', appointmentId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate clinic-specific query cache key
   */
  clinic(clinicId: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, 'clinic', clinicId];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Deterministically stringify a value for cache-key hashing: object keys are
   * sorted recursively so two calls describing the same query (e.g. two
   * `where: { clinicId, status }` vs `where: { status, clinicId }` literals
   * built in different field order) hash to the identical key. Plain
   * JSON.stringify preserves insertion order, which made the cache key depend
   * on how each call site happened to construct its params object rather than
   * on the query it actually describes - cache writes and reads for the
   * "same" query silently landed on different keys and never matched.
   * Array order is preserved since it's semantically significant (e.g. `in`
   * filters, orderBy lists).
   */
  private static stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map(item => QueryKeyFactory.stableStringify(item)).join(',')}]`;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(
      key =>
        `${JSON.stringify(key)}:${QueryKeyFactory.stableStringify((value as Record<string, unknown>)[key])}`
    );
    return `{${entries.join(',')}}`;
  }

  /**
   * Generate query cache key from operation and parameters
   */
  fromOperation(operation: string, params?: Record<string, unknown>): string {
    const parts = [this.KEY_PREFIX, 'operation', operation];
    if (params) {
      const paramString = QueryKeyFactory.stableStringify(params);
      // Hash long parameter strings to keep keys manageable
      if (paramString.length > 100) {
        // Simple hash for long strings
        let hash = 0;
        for (let i = 0; i < paramString.length; i++) {
          const char = paramString.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        parts.push(`params:${Math.abs(hash).toString(36)}`);
      } else {
        parts.push(`params:${paramString}`);
      }
    }
    return parts.join(this.KEY_SEPARATOR);
  }

  /**
   * Generate generic query cache key
   */
  generic(entity: string, id: string, suffix?: string): string {
    const parts = [this.KEY_PREFIX, entity, id];
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join(this.KEY_SEPARATOR);
  }
}
