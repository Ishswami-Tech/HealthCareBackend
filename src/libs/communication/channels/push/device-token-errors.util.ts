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
