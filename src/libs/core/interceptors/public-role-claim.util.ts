/**
 * Role claim of the caller on a `@Public()` route.
 *
 * Public routes skip JwtAuthGuard, so `request.user` is never set there and the global
 * BillingRedactionInterceptor cannot tell a DOCTOR from an anonymous visitor. A public route that
 * returns billing amounts (the appointment service catalog carries the video consultation fee a
 * patient needs to book) reads the role claim of the bearer token / `access_token` cookie with
 * this helper and strips the amounts for billing-blind roles.
 *
 * The token is decoded WITHOUT verifying its signature. That is safe only because the result is
 * used to REMOVE data: a forged or stale claim can only make the response smaller than what an
 * anonymous caller already receives. Never use this to grant access.
 */

interface RequestWithCredentials {
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}

function bearerToken(request: RequestWithCredentials): string | undefined {
  const raw = request.headers?.['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const [type, token] = (header ?? '').split(' ');
  if (type === 'Bearer' && token) return token;
  return request.cookies?.['access_token'] || undefined;
}

/** The `role` claim of an (unverified) JWT, upper-cased, or undefined. */
export function unverifiedRoleClaim(
  request: RequestWithCredentials | undefined
): string | undefined {
  if (!request) return undefined;
  const token = bearerToken(request);
  const payloadPart = token?.split('.')[1];
  if (!payloadPart) return undefined;
  try {
    const json = Buffer.from(payloadPart, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role.trim().toUpperCase() : undefined;
  } catch {
    return undefined;
  }
}
