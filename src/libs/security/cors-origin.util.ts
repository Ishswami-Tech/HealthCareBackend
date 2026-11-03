/**
 * Shared origin check for the development CORS callbacks (HTTP and Socket.IO).
 *
 * Local dev servers (Next.js, Expo, ...) get an auto-assigned port whenever the
 * default one is taken, so development also accepts any http://localhost:<port>.
 * Staging/production use the exact allow-list and never call this.
 *
 * A disallowed origin must be refused cleanly: the callbacks used to pass an
 * `Error`, which Fastify turned into a 500 for every hostile preflight (SEC-12).
 */

const LOCALHOST_ORIGIN_PATTERN = /^http:\/\/localhost:\d+$/;

export function isDevCorsOriginAllowed(
  origin: string | undefined,
  allowedOrigins: readonly string[]
): boolean {
  if (!origin) {
    // Same-origin requests, curl and server-to-server calls carry no Origin header.
    return true;
  }
  return allowedOrigins.includes(origin) || LOCALHOST_ORIGIN_PATTERN.test(origin);
}

export const CORS_ORIGIN_REJECTED_MESSAGE = 'Origin not allowed by CORS';
