/**
 * Pure helpers for the VALUE side of HealthcareCacheInterceptor: how long an entry lives, which
 * priority it is written with, and how a stored entry is unwrapped before it is replayed.
 */

import type { UnifiedCacheOptions } from '@core/types';

const DEFAULT_TTL_SECONDS = 3600;

/**
 * Unwrap SWR-wrapped cache values ({ data, timestamp }) to return the underlying data. If the
 * value isn't wrapped, return it as-is.
 */
export function unwrapCacheValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  if ('data' in obj && 'timestamp' in obj) {
    return obj['data'];
  }
  return value;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** True for `[]`, a JSON string of `[]`, and an SWR-wrapped `{ data: [], timestamp }`. */
export function isCachedEmptyArray(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  // Handle raw JSON strings (from setCacheValue's JSON.stringify)
  const parsed: unknown = typeof value === 'string' ? tryParseJson(value) : value;
  // Direct empty array
  if (Array.isArray(parsed) && parsed.length === 0) return true;
  // SWR-wrapped empty array: { data: [], timestamp: number }
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'data' in parsed &&
    Array.isArray((parsed as { data: unknown }).data) &&
    (parsed as { data: unknown[] }).data.length === 0
  );
}

/** Explicit TTL wins, then the healthcare data-class default, then the compliance level. */
export function calculateTTL(options: UnifiedCacheOptions): number {
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
    case 'restricted':
      return 900; // 15 minutes
    case 'sensitive':
      return 1800; // 30 minutes
    case 'standard':
    default:
      return DEFAULT_TTL_SECONDS;
  }
}

/** Healthcare data defaults to high priority. */
export function mapPriority(priority?: string): 'high' | 'low' {
  switch (priority) {
    case 'normal':
    case 'low':
      return 'low';
    case 'critical':
    case 'high':
    default:
      return 'high';
  }
}
