import { describe, it, expect } from '@jest/globals';
import { randomBytes } from 'crypto';
import {
  ENVELOPE_PREFIX,
  decryptField,
  encryptField,
  hashField,
  isEncryptedEnvelope,
  keyId,
  parseBooleanFlag,
  parseMasterKey,
  parseMasterKeyList,
} from '../../../src/libs/infrastructure/database/config/field-crypto.util';

const key = randomBytes(32);
const oldKey = randomBytes(32);
const aad = 'patient_visits.presentComplaints:visit-1';

describe('parseMasterKey', () => {
  it('accepts 32 random bytes as hex or base64', () => {
    expect(parseMasterKey(key.toString('hex')).equals(key)).toBe(true);
    expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true);
    expect(parseMasterKey(`  ${key.toString('hex')}\n`).equals(key)).toBe(true);
  });

  it('rejects passphrases and keys of the wrong size', () => {
    expect(() => parseMasterKey('correct horse battery staple')).toThrow(/32 random bytes/);
    expect(() => parseMasterKey(randomBytes(16).toString('hex'))).toThrow();
    expect(() => parseMasterKey(randomBytes(31).toString('base64'))).toThrow();
    expect(() => parseMasterKey('')).toThrow();
  });

  it('rejects look-alikes that a lenient base64 decoder would turn into 32 bytes', () => {
    expect(() => parseMasterKey('a'.repeat(43))).toThrow();
    expect(() => parseMasterKey('This-Is-A-Passphrase-That-Is-43-Chars-Long')).toThrow();
    expect(() => parseMasterKey(`${key.toString('base64').slice(0, 43)}!`)).toThrow();
  });

  it('rejects a key that repeats one byte', () => {
    expect(() => parseMasterKey('00'.repeat(32))).toThrow(/not random/);
    expect(() => parseMasterKey('ff'.repeat(32))).toThrow(/not random/);
    expect(() => parseMasterKey(Buffer.alloc(32, 7).toString('base64'))).toThrow(/not random/);
  });
});

describe('parseMasterKeyList', () => {
  it('parses a comma-separated list and ignores blanks', () => {
    const list = parseMasterKeyList(` ${key.toString('hex')} , ${oldKey.toString('base64')} ,, `);
    expect(list).toHaveLength(2);
    expect(list[0]?.equals(key)).toBe(true);
    expect(list[1]?.equals(oldKey)).toBe(true);
    expect(parseMasterKeyList('')).toEqual([]);
  });

  it('fails on any invalid entry', () => {
    expect(() => parseMasterKeyList(`${key.toString('hex')},not-a-key`)).toThrow();
  });
});

describe('encryptField / decryptField', () => {
  it('round-trips text, including Devanagari and emoji', () => {
    for (const text of ['fever for 3 days', 'ताप, खोकला', 'पित्त 🔥', 'x'.repeat(5000)]) {
      const envelope = encryptField(key, text, aad);
      expect(envelope.startsWith(ENVELOPE_PREFIX)).toBe(true);
      expect(envelope).not.toContain(text.slice(0, 6));
      expect(decryptField([key], envelope, aad)).toBe(text);
    }
  });

  it('carries the key id of the sealing key in the envelope', () => {
    const envelope = encryptField(key, 'a', aad);
    expect(envelope.startsWith(`${ENVELOPE_PREFIX}${keyId(key)}:`)).toBe(true);
    expect(keyId(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(keyId(key)).toBe(keyId(Buffer.from(key)));
    expect(keyId(key)).not.toBe(keyId(oldKey));
  });

  it('uses a fresh salt and IV every time', () => {
    expect(encryptField(key, 'same text', aad)).not.toBe(encryptField(key, 'same text', aad));
  });

  it('refuses a value moved to another row or column', () => {
    const envelope = encryptField(key, 'note for visit 1', aad);
    expect(() =>
      decryptField([key], envelope, 'patient_visits.presentComplaints:visit-2')
    ).toThrow();
    expect(() => decryptField([key], envelope, 'patient_visits.knownCaseOf:visit-1')).toThrow();
  });

  it('refuses a key that did not seal the value, and a tampered value', () => {
    const envelope = encryptField(key, 'secret', aad);
    expect(() => decryptField([randomBytes(32)], envelope, aad)).toThrow(/No configured key/);
    const [head, body] = [envelope.slice(0, ENVELOPE_PREFIX.length + 9), envelope.slice(ENVELOPE_PREFIX.length + 9)];
    const bytes = Buffer.from(body, 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] as number) ^ 0xff;
    expect(() => decryptField([key], `${head}${bytes.toString('base64')}`, aad)).toThrow();
  });

  it('supports rotation: old values open with the previous key, new values use the new one', () => {
    const sealedOld = encryptField(oldKey, 'sealed before rotation', aad);
    expect(decryptField([key, oldKey], sealedOld, aad)).toBe('sealed before rotation');
    expect(() => decryptField([key], sealedOld, aad)).toThrow(/No configured key/);
    const sealedNew = encryptField(key, 'sealed after rotation', aad);
    expect(sealedNew.startsWith(`${ENVELOPE_PREFIX}${keyId(key)}:`)).toBe(true);
    expect(decryptField([key, oldKey], sealedNew, aad)).toBe('sealed after rotation');
  });

  it('refuses plaintext, a missing key id and truncated input instead of guessing', () => {
    expect(() => decryptField([key], 'plain text note', aad)).toThrow(/not an encrypted envelope/);
    expect(() => decryptField([key], `${ENVELOPE_PREFIX}AAAA`, aad)).toThrow(/no key id/);
    expect(() => decryptField([key], `${ENVELOPE_PREFIX}${keyId(key)}:AAAA`, aad)).toThrow(
      /truncated/
    );
  });
});

describe('isEncryptedEnvelope', () => {
  it('tells ciphertext from legacy plaintext, even plaintext that looks like base64', () => {
    expect(isEncryptedEnvelope(encryptField(key, 'a', aad))).toBe(true);
    expect(isEncryptedEnvelope('fever for 3 days')).toBe(false);
    expect(isEncryptedEnvelope(Buffer.alloc(80, 1).toString('base64'))).toBe(false);
    expect(isEncryptedEnvelope('')).toBe(false);
  });
});

describe('hashField', () => {
  it('is deterministic per key and differs between keys and values', () => {
    expect(hashField(key, 'abc')).toBe(hashField(key, 'abc'));
    expect(hashField(key, 'abc')).not.toBe(hashField(key, 'abd'));
    expect(hashField(key, 'abc')).not.toBe(hashField(randomBytes(32), 'abc'));
    expect(hashField(key, 'abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseBooleanFlag', () => {
  it('reads the usual spellings in any case', () => {
    for (const on of ['true', 'TRUE', 'True', '1', 'yes', 'ON', ' true ']) {
      expect(parseBooleanFlag(on, 'X')).toBe(true);
    }
    for (const off of ['false', 'FALSE', '0', 'no', 'off', '', undefined, null]) {
      expect(parseBooleanFlag(off, 'X')).toBe(false);
    }
  });

  it('refuses an unrecognised value instead of silently meaning "off"', () => {
    expect(() => parseBooleanFlag('treu', 'FIELD_ENCRYPTION_REQUIRED')).toThrow(
      /FIELD_ENCRYPTION_REQUIRED must be true or false/
    );
    expect(() => parseBooleanFlag('2', 'X')).toThrow();
  });
});
