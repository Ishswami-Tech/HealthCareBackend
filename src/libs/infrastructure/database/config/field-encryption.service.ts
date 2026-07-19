/**
 * Field Encryption Service
 * =========================
 * Provides AES-256-GCM encryption for PHI fields (phone, address, etc.).
 *
 * This service is the **building block** for at-rest field encryption. It is
 * exposed so that:
 *   1. Services can opt in by calling `fieldEncryption.encrypt(plainText)`
 *      before passing data to Prisma.
 *   2. Services can opt in by calling `fieldEncryption.decrypt(cipherText)`
 *      after reading from Prisma.
 *   3. Future Prisma `$extends` result middleware can transparently wrap the
 *      encryption without changing call sites.
 *
 * Migration strategy:
 *   - New writes use encrypt()
 *   - Existing plaintext records are encrypted via a one-off migration script
 *   - Reads decrypt on the way out, falling back to plaintext for legacy rows
 *
 * Storage format (base64): salt(32B) + iv(16B) + authTag(16B) + ciphertext
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config';
import * as crypto from 'crypto';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100_000;

@Injectable()
export class FieldEncryptionService {
  private readonly encryptionKey: Buffer;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    const rawKey = this.configService.get<string>('FIELD_ENCRYPTION_KEY', '');
    this.enabled = Boolean(rawKey);

    if (this.enabled) {
      this.encryptionKey = crypto.createHash('sha256').update(rawKey).digest();
    } else {
      this.encryptionKey = Buffer.alloc(0);
    }
  }

  /**
   * Returns true if a FIELD_ENCRYPTION_KEY was provided at startup.
   * When disabled, encrypt() returns plaintext and decrypt() returns input.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Encrypt a plaintext value. Returns null if input is null/empty.
   * If encryption is disabled (no key configured), returns plaintext as-is.
   */
  encrypt(plaintext: string | null | undefined): string | null {
    if (!plaintext || plaintext.trim() === '') return null;
    if (!this.enabled) return plaintext;

    try {
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);
      const key = crypto.pbkdf2Sync(this.encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');

      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();
      const combined = Buffer.concat([salt, iv, tag, Buffer.from(encrypted, 'hex')]);
      return combined.toString('base64');
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Field encryption failed',
        'FieldEncryptionService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  /**
   * Decrypt a ciphertext value. Returns null if input is null.
   *
   * If the input does not look like an encrypted blob (i.e. is not valid base64
   * of the expected length), it's returned as-is. This makes the function
   * safe to call on legacy plaintext rows during the migration window.
   */
  decrypt(ciphertext: string | null | undefined): string | null {
    if (!ciphertext) return null;
    if (!this.enabled) return ciphertext;

    try {
      const combined = Buffer.from(ciphertext, 'base64');
      // Magic-number check: must be at least the header size
      const minLength = SALT_LENGTH + IV_LENGTH + TAG_LENGTH;
      if (combined.length < minLength) {
        return ciphertext;
      }

      const salt = combined.subarray(0, SALT_LENGTH);
      const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

      const key = crypto.pbkdf2Sync(this.encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      // Not a valid blob — assume legacy plaintext and return as-is
      return ciphertext;
    }
  }

  /**
   * Compute a deterministic, lower-case, normalized HMAC-SHA256 hash of the
   * input for use with @unique constraints (cannot use ciphertext because
   * it's randomized).
   *
   * If encryption is disabled, returns lower-case trimmed plaintext so lookups
   * still work during the migration window.
   */
  hash(plaintext: string | null | undefined): string | null {
    if (!plaintext || plaintext.trim() === '') return null;

    try {
      if (!this.enabled) {
        return plaintext.trim().toLowerCase();
      }
      return crypto
        .createHmac('sha256', this.encryptionKey)
        .update(plaintext.trim().toLowerCase())
        .digest('hex');
    } catch {
      return null;
    }
  }
}
