import { createHash, timingSafeEqual } from 'crypto';

import {
  parseIpList,
  parseTrustedProxyHops,
  resolveClientIpFromForwardedFor,
} from '@security/rate-limit/rate-limit-keys.util';

/**
 * Access control for the Bull Board queue dashboard (audit P0-4).
 *
 * Bull Board is mounted as a raw Fastify plugin, so Nest guards never run for it. Job payloads
 * contain PHI (patient names, phones, appointment data) and the UI can retry/delete jobs, so:
 *  - production-like envs (production, staging, local-prod): mounted ONLY when
 *    QUEUE_DASHBOARD_ENABLED=true AND QUEUE_DASHBOARD_USER + QUEUE_DASHBOARD_PASSWORD
 *    (min 16 chars) are set. Every request then needs HTTP Basic auth.
 *  - development: keeps the legacy ENABLE_BULL_BOARD behaviour; Basic auth is enforced when
 *    credentials are configured.
 *  - QUEUE_DASHBOARD_ALLOWED_IPS (comma-separated exact IPs) adds an IP allow-list in any env.
 *    The client IP honours exactly TRUSTED_PROXY_HOPS X-Forwarded-For entries (default 1).
 * Repeated bad credentials from one IP are throttled in memory (10 per 15 minutes).
 */

const PROD_LIKE_ENVS = new Set(['production', 'staging', 'local-prod']);
const MIN_PASSWORD_LENGTH = 16;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const REALM = 'Basic realm="Queue Dashboard", charset="UTF-8"';

export interface QueueDashboardAccess {
  readonly mount: boolean;
  readonly reason: string;
  readonly requireAuth: boolean;
  readonly allowedIps: ReadonlySet<string>;
  readonly proxyHops: number;
  readonly userDigest?: Buffer;
  readonly passwordDigest?: Buffer;
}

interface DashboardRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly raw: { readonly socket?: { readonly remoteAddress?: string } };
}

interface DashboardReply {
  code(statusCode: number): DashboardReply;
  header(name: string, value: string): DashboardReply;
  send(payload: string | Record<string, string | number>): DashboardReply;
}

export type QueueDashboardHook = (
  request: DashboardRequest,
  reply: DashboardReply
) => Promise<DashboardReply | undefined>;

type EnvSource = Readonly<Record<string, string | undefined>>;

function isTruthy(value: string | undefined): boolean {
  return ['true', '1', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Decide whether and how the dashboard may be mounted in this process. */
export function resolveQueueDashboardAccess(env: EnvSource = process.env): QueueDashboardAccess {
  const nodeEnv = (env['NODE_ENV'] || 'development').trim().toLowerCase();
  const prodLike = PROD_LIKE_ENVS.has(nodeEnv);
  const user = (env['QUEUE_DASHBOARD_USER'] || '').trim();
  const password = env['QUEUE_DASHBOARD_PASSWORD'] || '';
  const hasCredentials = user.length > 0 && password.length > 0;
  const base = {
    allowedIps: parseIpList(env['QUEUE_DASHBOARD_ALLOWED_IPS']),
    proxyHops: parseTrustedProxyHops(env['TRUSTED_PROXY_HOPS'] ?? env['TRUST_PROXY'], 1),
    ...(hasCredentials && { userDigest: digest(user), passwordDigest: digest(password) }),
  };

  if (prodLike) {
    if (!isTruthy(env['QUEUE_DASHBOARD_ENABLED'])) {
      return {
        ...base,
        mount: false,
        requireAuth: true,
        reason: `disabled in ${nodeEnv} (set QUEUE_DASHBOARD_ENABLED=true to mount it)`,
      };
    }
    if (!hasCredentials || password.length < MIN_PASSWORD_LENGTH) {
      return {
        ...base,
        mount: false,
        requireAuth: true,
        reason:
          'QUEUE_DASHBOARD_ENABLED=true but QUEUE_DASHBOARD_USER / QUEUE_DASHBOARD_PASSWORD ' +
          `(min ${MIN_PASSWORD_LENGTH} chars) are not set - refusing to mount an open dashboard`,
      };
    }
    return { ...base, mount: true, requireAuth: true, reason: 'enabled with Basic auth' };
  }

  return {
    ...base,
    mount: true,
    requireAuth: hasCredentials,
    reason: hasCredentials ? 'development, Basic auth enforced' : 'development, no auth configured',
  };
}

function credentialsMatch(header: string | undefined, access: QueueDashboardAccess): boolean {
  if (!header || !access.userDigest || !access.passwordDigest) {
    return false;
  }
  const [scheme, encoded] = header.split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) {
    return false;
  }
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return false;
  }
  // Compare fixed-length digests so neither length nor content leaks through timing.
  const userOk = timingSafeEqual(digest(decoded.slice(0, separator)), access.userDigest);
  const passwordOk = timingSafeEqual(digest(decoded.slice(separator + 1)), access.passwordDigest);
  return userOk && passwordOk;
}

/** Fastify onRequest hook enforcing the IP allow-list and Basic auth for the dashboard. */
export function createQueueDashboardAuthHook(access: QueueDashboardAccess): QueueDashboardHook {
  const failures = new Map<string, { count: number; firstAt: number }>();

  return (
    request: DashboardRequest,
    reply: DashboardReply
  ): Promise<DashboardReply | undefined> => {
    const socketIp = request.raw.socket?.remoteAddress || 'unknown';
    const clientIp = resolveClientIpFromForwardedFor(
      socketIp,
      request.headers['x-forwarded-for'],
      access.proxyHops
    ).replace(/^::ffff:/, '');

    if (access.allowedIps.size > 0 && !access.allowedIps.has(clientIp)) {
      return Promise.resolve(reply.code(403).send({ statusCode: 403, message: 'Forbidden' }));
    }
    if (!access.requireAuth) {
      return Promise.resolve(undefined);
    }

    const now = Date.now();
    const entry = failures.get(clientIp);
    if (entry && now - entry.firstAt < FAILURE_WINDOW_MS && entry.count >= MAX_FAILURES) {
      return Promise.resolve(
        reply
          .code(429)
          .header(
            'Retry-After',
            String(Math.ceil((entry.firstAt + FAILURE_WINDOW_MS - now) / 1000))
          )
          .send({ statusCode: 429, message: 'Too many failed attempts' })
      );
    }

    const header = request.headers['authorization'];
    if (credentialsMatch(Array.isArray(header) ? header[0] : header, access)) {
      failures.delete(clientIp);
      return Promise.resolve(undefined);
    }

    if (failures.size > 10_000) {
      failures.clear(); // bound memory under an IP-spraying attack
    }
    if (!entry || now - entry.firstAt >= FAILURE_WINDOW_MS) {
      failures.set(clientIp, { count: 1, firstAt: now });
    } else {
      failures.set(clientIp, { count: entry.count + 1, firstAt: entry.firstAt });
    }
    return Promise.resolve(
      reply
        .code(401)
        .header('WWW-Authenticate', REALM)
        .send({ statusCode: 401, message: 'Authentication required' })
    );
  };
}
