/**
 * Recognises the database refusing a device token because its user row does not exist
 * (Prisma P2003 on `device_tokens_userId_fkey`), e.g. a session whose user was deleted.
 */
export function isUnknownUserForeignKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { code?: unknown; message?: unknown; meta?: { field_name?: unknown } };
  const text = [record.message, record.meta?.field_name]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const mentionsUserFk = /device_tokens_userId_fkey/i.test(text);
  return mentionsUserFk && (record.code === undefined || record.code === 'P2003');
}

/** FCM v1 error body: `{ error: { status, message, details: [{ errorCode }] } }`. */
interface FcmErrorShape {
  readonly message?: string;
  readonly payload?: {
    readonly error?: {
      readonly status?: string;
      readonly details?: ReadonlyArray<{ readonly errorCode?: string }>;
    };
  };
}

const UNREGISTERED_TOKEN_MESSAGE =
  /UNREGISTERED|NotRegistered|registration-token-not-registered|Requested entity was not found|not a valid FCM registration token/i;

/**
 * Recognises FCM refusing a device token for good (app uninstalled, token rotated or never
 * valid), so the token can be retired. Production returned the bare message "NotRegistered",
 * which the old /UNREGISTERED|NOT_FOUND|.../ check missed, so the dead token was retried forever.
 */
export function isUnregisteredFcmTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { message, payload } = error as FcmErrorShape;
  const codes = (payload?.error?.details ?? []).map(detail => detail.errorCode);
  if (codes.includes('UNREGISTERED')) return true;
  return typeof message === 'string' && UNREGISTERED_TOKEN_MESSAGE.test(message);
}
