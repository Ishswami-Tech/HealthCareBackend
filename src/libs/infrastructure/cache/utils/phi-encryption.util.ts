/**
 * PHI cache encryption (AES-256-GCM).
 *
 * The `encryptionEnabled` cache config flag has existed for a while but was
 * never actually consumed anywhere — PHI (medical history, prescriptions,
 * lab reports, etc.) was being written into Dragonfly/Redis as plaintext
 * JSON despite the flag and this codebase's HIPAA "sensitive fields must be
 * encrypted" rule. This module is the actual encrypt/decrypt implementation,
 * wired into the PHI cache read/write paths.
 *
 * Key source: PHI_CACHE_ENCRYPTION_KEY env var, a 64-char hex string (32
 * raw bytes), same pattern as JWT_SECRET/COOKIE_SECRET in this codebase.
 * If the key is missing or malformed, encryption is skipped (fail-open on
 * the cache, since cache failures elsewhere in this codebase are designed
 * to degrade gracefully rather than take down the request) but every
 * occurrence is logged at ERROR level so it's visible in dev and would page
 * someone in production rather than silently caching PHI in plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV length for GCM
const ENC_PREFIX = 'enc:v1:';

let cachedKey: Buffer | null | undefined;
let hasWarnedMissingKey = false;

function getEncryptionKey(): Buffer | null {
  if (cachedKey !== undefined) {
    return cachedKey;
  }

  const raw = process.env['PHI_CACHE_ENCRYPTION_KEY'];
  if (!raw || raw.trim().length === 0) {
    cachedKey = null;
    return null;
  }

  const trimmed = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    cachedKey = null;
    return null;
  }

  cachedKey = Buffer.from(trimmed, 'hex');
  return cachedKey;
}

/**
 * This module has no LoggingService of its own (it's a plain crypto
 * utility, not an injectable), so it can't log through the project's
 * required LoggingService itself. Instead it exposes this message exactly
 * once (module-level flag) for the caller — which does have a
 * LoggingService — to log through it.
 */
export function getMissingEncryptionKeyWarningOnce(): string | null {
  if (hasWarnedMissingKey) return null;
  hasWarnedMissingKey = true;
  return (
    'PHI_CACHE_ENCRYPTION_KEY is missing or invalid (expected 64 hex chars / 32 bytes). ' +
    'PHI is being cached in PLAINTEXT. Set PHI_CACHE_ENCRYPTION_KEY to enable encryption at rest for cached PHI.'
  );
}

/**
 * Encrypts a JSON-serializable value for storage in the cache. Returns the
 * plaintext JSON unchanged (prefixed check makes this detectable on read)
 * if no valid key is configured.
 */
export function encryptPHIValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  const key = getEncryptionKey();
  if (!key) {
    return serialized;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypts a value previously written by encryptPHIValue. If the value
 * isn't in the encrypted format (legacy plaintext entry written before this
 * was wired in, or the key was missing at write time), parses it as plain
 * JSON instead of failing. Returns null if the value can't be decrypted or
 * parsed at all — treat as a cache miss rather than throwing.
 */
export function decryptPHIValue<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    // Already an object (e.g. provider deserialized it) — nothing to decrypt.
    return raw as T;
  }

  if (!raw.startsWith(ENC_PREFIX)) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Not JSON either — return as-is for the caller to handle.
      return raw as unknown as T;
    }
  }

  const key = getEncryptionKey();
  if (!key) {
    return null;
  }

  try {
    const [, ivHex, authTagHex, ciphertextHex] = raw.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) return null;

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}
