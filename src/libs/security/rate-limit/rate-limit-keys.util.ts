import { createHash } from 'crypto';
import { verify as verifyJwt } from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';

/**
 * Pure helpers shared by the global Fastify rate limiter, the per-route RouteRateLimitGuard and
 * the queue dashboard IP allow-list. No Nest dependencies so they can be unit-tested directly.
 *
 * Keying policy (audit P0-6 / P1 rate limiting):
 *  - Authenticated requests are keyed by the VERIFIED JWT subject, never by IP, so a clinic
 *    behind one NAT (or every web user behind the Next.js server) does not share one bucket.
 *  - Anonymous requests are keyed by client IP only. User-Agent is never part of a key: changing
 *    the UA must not mint a fresh bucket.
 *  - Auth/OTP routes are additionally keyed by the hashed login identifier (phone/email), which
 *    is independent of IP and UA.
 */

/** Minimal request shape (Fastify request / Nest http request) used for key derivation. */
export interface RateLimitRequestLike {
  readonly ip?: string;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
  readonly socket?: { readonly remoteAddress?: string };
  readonly raw?: { readonly socket?: { readonly remoteAddress?: string } };
}

/** Body fields that carry a login identifier on auth/OTP routes, in priority order. */
const IDENTIFIER_FIELDS = ['identifier', 'phone', 'phoneNumber', 'email', 'username'] as const;

/** Loopback / RFC1918 / unique-local / link-local peers (Docker networks, Traefik, host). */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, '').toLowerCase();
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) {
    return true;
  }
  const octets = ip.split('.').map(part => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part))) {
    return false;
  }
  const [a = -1, b = -1] = octets;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Fastify `trustProxy` function trusting exactly `hops` proxies. A plain number is NOT used:
 * Fastify 5 treats a numeric hop count as "trust nothing" (fail closed), which would put every
 * client behind Traefik into Traefik's single IP bucket. `true` would trust the left-most,
 * client-controlled X-Forwarded-For entry. Here hop 0 (the socket peer) is trusted only when it
 * is a private address (Traefik / Docker network), so a client reaching the port directly
 * cannot spoof X-Forwarded-For; the next `hops - 1` entries (e.g. Cloudflare) are trusted by
 * position. Returns false when hops is 0.
 */
export function buildTrustProxyFn(
  hops: number
): ((address: string, hop: number) => boolean) | false {
  if (hops <= 0) {
    return false;
  }
  return (address: string, hop: number): boolean =>
    hop < hops && (hop > 0 || isPrivateAddress(address));
}

/** Number of trusted proxy hops (TRUSTED_PROXY_HOPS). Traefik in front = 1. */
export function parseTrustedProxyHops(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    return fallback;
  }
  return value;
}

/** Bearer token from the Authorization header, if any. */
export function extractBearerToken(
  headers: Readonly<Record<string, string | string[] | undefined>> | undefined
): string | null {
  const header = headers?.['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return null;
  }
  const [scheme, token] = value.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

/**
 * Subject (user id) of a token whose signature and expiry verify against `secret`.
 * Returns null for a missing, forged, expired or malformed token: an unverified `sub` must
 * never select a bucket, otherwise a forged token would mint unlimited fresh buckets.
 */
export function resolveVerifiedSubject(token: string | null, secret: string): string | null {
  if (!token || !secret) {
    return null;
  }
  try {
    const decoded = verifyJwt(token, secret);
    if (typeof decoded === 'string') {
      return null;
    }
    const payload: JwtPayload = decoded;
    const subject = payload.sub ?? (payload as Record<string, string | undefined>)['id'];
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

/** Client IP as resolved by Fastify `trustProxy` (request.ip), with socket fallbacks. */
export function resolveRequestIp(request: RateLimitRequestLike): string {
  return (
    request.ip || request.socket?.remoteAddress || request.raw?.socket?.remoteAddress || 'unknown'
  );
}

/**
 * Client IP for a server that does NOT have Fastify `trustProxy` set (the worker's Bull Board
 * HTTP server): honour exactly `hops` X-Forwarded-For entries appended by our own proxies and
 * ignore anything further left, which the client controls.
 */
export function resolveClientIpFromForwardedFor(
  socketIp: string,
  forwardedFor: string | string[] | undefined,
  hops: number
): string {
  if (hops <= 0) {
    return socketIp;
  }
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const chain = (raw || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  // The socket peer is the last proxy; each trusted hop vouches for one entry from the right.
  const index = chain.length - hops;
  return index >= 0 ? (chain[index] ?? socketIp) : (chain[0] ?? socketIp);
}

/** Normalised, hashed login identifier from an auth/OTP request body (no PII in cache keys). */
export function extractHashedIdentifier(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, string | number | undefined>;
  for (const field of IDENTIFIER_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || value.trim() === '') {
      continue;
    }
    const trimmed = value.trim().toLowerCase();
    const normalised = trimmed.includes('@') ? trimmed : trimmed.replace(/\D/g, '').slice(-10);
    if (normalised.length === 0) {
      continue;
    }
    return createHash('sha256').update(normalised).digest('hex').slice(0, 24);
  }
  return null;
}

/** Comma-separated IP list (exact matches) from an env value. */
export function parseIpList(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0)
  );
}

/** Global limiter identity: verified user when possible, otherwise client IP. */
export function resolveGlobalRateLimitKey(
  request: RateLimitRequestLike,
  jwtSecret: string
): string {
  const subject = resolveVerifiedSubject(extractBearerToken(request.headers), jwtSecret);
  return subject ? `user:${subject}` : `ip:${resolveRequestIp(request)}`;
}
