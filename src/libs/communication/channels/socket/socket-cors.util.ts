const LOCALHOST_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:8088',
  'http://localhost:8082',
];

function deriveFrontendOrigins(frontendUrl: string): string[] {
  const trimmed = frontendUrl.trim();
  if (!trimmed) {
    return [];
  }

  const isLocalhostLike = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/.*)?$/i.test(trimmed);

  try {
    const normalized = /^[a-z]+:\/\//i.test(trimmed)
      ? trimmed
      : isLocalhostLike
        ? `http://${trimmed}`
        : `https://${trimmed}`;
    const parsed = new URL(normalized);
    const base = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    const www = `${parsed.protocol}//www.${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    return [base, www];
  } catch {
    const cleaned = trimmed.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!cleaned) {
      return [];
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/.*)?$/i.test(cleaned)) {
      return [`http://${cleaned}`];
    }
    return [`https://${cleaned}`, `https://www.${cleaned}`];
  }
}

type SocketCorsOriginValidator = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void
) => void;

function resolveExplicitOrigins(): string[] {
  const corsOrigin = process.env['CORS_ORIGIN'] || '';
  if (corsOrigin) {
    return corsOrigin
      .split(',')
      .map((origin: string) => origin.trim())
      .filter(Boolean);
  }

  const frontendUrl = process.env['FRONTEND_URL'] || '';
  if (frontendUrl) {
    const derived = deriveFrontendOrigins(frontendUrl);
    if (derived.length > 0) {
      return derived;
    }
  }

  return [];
}

export function getSocketCorsOrigin(): string | string[] | SocketCorsOriginValidator {
  const explicitOrigins = resolveExplicitOrigins();
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (isProduction) {
    return explicitOrigins;
  }

  // Local dev servers (Next.js, Expo, etc.) get an auto-assigned port whenever
  // their default port is taken, so a fixed allow-list falls out of date on
  // every restart. Accept any http://localhost:<port> origin in non-production
  // only; see security-config.service.ts's configureCORS() for the HTTP equivalent.
  const allowedOrigins = explicitOrigins.length > 0 ? explicitOrigins : LOCALHOST_ORIGINS;
  const localhostOriginPattern = /^http:\/\/localhost:\d+$/;

  return (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || localhostOriginPattern.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  };
}
