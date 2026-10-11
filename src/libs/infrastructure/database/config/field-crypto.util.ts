/**
 * Field-level encryption primitives for PHI stored in the database. Pure functions, no framework
 * imports, so they can be unit tested on their own.
 *
 * Envelope: `enc:v2:<keyId>:` + base64( salt(16) | iv(12) | authTag(16) | ciphertext ).
 *  - AES-256-GCM, a fresh 96-bit IV per value.
 *  - The per-value key comes from HKDF-SHA256(masterKey, salt). The master key is 32 random bytes,
 *    not a passphrase, so password-stretching (PBKDF2) buys nothing and costs ~65 ms per value.
 *  - `aad` (additional authenticated data) binds a value to where it lives, e.g.
 *    `patient_visits.presentComplaints:<visitId>`: moving the ciphertext to another row or column
 *    makes decryption fail instead of silently showing another patient's note.
 *  - `keyId` (first 8 hex characters of SHA-256 of the master key) says which key sealed the value,
 *    so a key can be rotated: new writes use the current key, old values still open with a
 *    previous key until they are re-encrypted. It is a fingerprint, not secret material.
 *  - The explicit prefix tells ciphertext from legacy plaintext, so there is no guessing.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'crypto';

export const ENVELOPE_PREFIX = 'enc:v2:';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_LENGTH = 8;
const KDF_INFO = 'healthcare-field-encryption-v2';
const HASH_INFO = 'healthcare-field-hash-v2';
const HEX_KEY = /^[0-9a-fA-F]{64}$/;
// 32 bytes encode to 44 base64 characters ending in one "=" (standard alphabet, no whitespace).
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

export function isEncryptedEnvelope(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX);
}

/** Short fingerprint of a master key; safe to store next to the ciphertext. */
export function keyId(masterKey: Buffer): string {
  return createHash('sha256').update(masterKey).digest('hex').slice(0, KEY_ID_LENGTH);
}

/**
 * Master key from configuration: 32 random bytes written as 64 hex characters or as standard
 * base64 (`openssl rand -base64 32`). Anything else is rejected, so a guessable passphrase can
 * never be used, and so is a key made of one repeated byte (all zeros, all 0xff, ...).
 */
export function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  let key: Buffer | null = null;
  if (HEX_KEY.test(trimmed)) key = Buffer.from(trimmed, 'hex');
  else if (BASE64_KEY.test(trimmed)) key = Buffer.from(trimmed, 'base64');
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      'FIELD_ENCRYPTION_KEY must be 32 random bytes as 64 hex characters or base64 (openssl rand -base64 32)'
    );
  }
  if (key.every(byte => byte === key[0])) {
    throw new Error('FIELD_ENCRYPTION_KEY is not random: it repeats a single byte');
  }
  return key;
}

/** Comma-separated list of master keys (used for the "previous keys" setting). */
export function parseMasterKeyList(raw: string): Buffer[] {
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(parseMasterKey);
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, salt, KDF_INFO, KEY_BYTES));
}

export function encryptField(masterKey: Buffer, plaintext: string, aad: string): string {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(masterKey, salt), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const body = Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]);
  return `${ENVELOPE_PREFIX}${keyId(masterKey)}:${body.toString('base64')}`;
}

/**
 * Decrypts an envelope with whichever of `keys` sealed it. Throws when the value was altered or
 * moved, or when none of the keys is the one that sealed it.
 */
export function decryptField(keys: readonly Buffer[], envelope: string, aad: string): string {
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error('Value is not an encrypted envelope');
  }
  const rest = envelope.slice(ENVELOPE_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator !== KEY_ID_LENGTH) {
    throw new Error('Encrypted value has no key id');
  }
  const sealedWith = rest.slice(0, separator);
  const masterKey = keys.find(candidate => keyId(candidate) === sealedWith);
  if (!masterKey) {
    throw new Error('No configured key matches the key that sealed this value');
  }
  const bytes = Buffer.from(rest.slice(separator + 1), 'base64');
  if (bytes.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted value is truncated');
  }
  const salt = bytes.subarray(0, SALT_BYTES);
  const iv = bytes.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = bytes.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = bytes.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, deriveKey(masterKey, salt), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Deterministic keyed hash for equality lookups on a value that is otherwise encrypted. */
export function hashField(masterKey: Buffer, normalisedValue: string): string {
  const hashKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), HASH_INFO, KEY_BYTES));
  return createHmac('sha256', hashKey).update(normalisedValue).digest('hex');
}

/** Strict boolean setting: true/1/yes/on or false/0/no/off (any case); anything else throws. */
export function parseBooleanFlag(raw: unknown, name: string): boolean {
  if (raw === undefined || raw === null) return false;
  const text =
    typeof raw === 'string'
      ? raw
      : typeof raw === 'boolean' || typeof raw === 'number'
        ? String(raw)
        : null;
  if (text === null) {
    throw new Error(`${name} must be true or false`);
  }
  const value = text.trim().toLowerCase();
  if (value === '') return false;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(`${name} must be true or false, got "${text.slice(0, 20)}"`);
}
