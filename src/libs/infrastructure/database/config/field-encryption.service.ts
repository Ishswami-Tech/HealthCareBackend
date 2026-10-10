/**
 * Field Encryption Service
 * ========================
 * AES-256-GCM encryption for PHI stored in database columns (see field-crypto.util.ts for the
 * envelope format and why HKDF, not PBKDF2, derives the per-value key).
 *
 * Opt-in per call site (through DatabaseService.encryptPhiField / decryptPhiField):
 *   - `encrypt(value, aad)` before writing, `decrypt(value, aad)` after reading.
 *   - `aad` binds a value to its row and column, e.g. `patient_visits.presentComplaints:<id>`.
 *
 * Rollout without a big-bang migration:
 *   - No key configured: `encrypt` returns the plaintext and `decrypt` returns plaintext rows as
 *     they are. Nothing changes until FIELD_ENCRYPTION_KEY is set. In production this logs an
 *     ERROR at every start, because stored PHI is then not encrypted.
 *   - Key set: new writes are encrypted; existing plaintext rows still read fine (they carry no
 *     `enc:v2:` prefix) and are encrypted by a one-off backfill.
 *   - A value that carries the prefix but cannot be decrypted (wrong key, altered, moved to another
 *     row) is an error, never silently returned: ciphertext must not reach a screen.
 *   - FIELD_ENCRYPTION_REQUIRED=true refuses to start without a key. Turn it on in production once
 *     the key is provisioned (setting it before the key exists would stop the API from starting).
 *     The setting is parsed strictly: an unrecognised value stops startup instead of meaning "off".
 *
 * Key: 32 random bytes (`openssl rand -base64 32`). Passphrases are rejected.
 * Rotation: put the new key in FIELD_ENCRYPTION_KEY and the old one(s) in
 * FIELD_ENCRYPTION_KEY_PREVIOUS (comma separated). Old values keep opening; new writes use the new
 * key; re-encrypt, then drop the old key.
 */

import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import {
  ENVELOPE_PREFIX,
  decryptField,
  encryptField,
  hashField,
  isEncryptedEnvelope,
  parseBooleanFlag,
  parseMasterKey,
  parseMasterKeyList,
} from './field-crypto.util';

@Injectable()
export class FieldEncryptionService {
  private readonly serviceName = 'FieldEncryptionService';
  private readonly masterKey: Buffer | null;
  private readonly readKeys: readonly Buffer[];

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    const isProduction = String(this.configService.get('NODE_ENV', '')) === 'production';
    const { required, current, previous } = this.readSettings();
    if (!current && required) {
      throw this.configError(
        'FIELD_ENCRYPTION_REQUIRED is true but FIELD_ENCRYPTION_KEY is not set'
      );
    }

    this.masterKey = current;
    this.readKeys = current ? [current, ...previous] : [];
    if (!current) {
      void this.loggingService.log(
        LogType.SYSTEM,
        isProduction ? LogLevel.ERROR : LogLevel.WARN,
        'FIELD_ENCRYPTION_KEY is not set: clinical text fields are stored unencrypted',
        this.serviceName
      );
    }
  }

  /** Reads and validates the encryption settings; an invalid setting stops startup. */
  private readSettings(): { required: boolean; current: Buffer | null; previous: Buffer[] } {
    try {
      const rawKey = this.configService.get<string>('FIELD_ENCRYPTION_KEY', '');
      const rawPrevious = this.configService.get<string>('FIELD_ENCRYPTION_KEY_PREVIOUS', '');
      return {
        required: parseBooleanFlag(
          this.configService.get('FIELD_ENCRYPTION_REQUIRED', ''),
          'FIELD_ENCRYPTION_REQUIRED'
        ),
        current: rawKey ? parseMasterKey(rawKey) : null,
        previous: rawPrevious ? parseMasterKeyList(rawPrevious) : [],
      };
    } catch (error) {
      throw this.configError(error instanceof Error ? error.message : 'Invalid encryption setting');
    }
  }

  /** True when a valid key was configured at startup. */
  isEnabled(): boolean {
    return this.masterKey !== null;
  }

  /**
   * Encrypts a value for storage. Null/empty input returns null; with no key configured the
   * plaintext is returned unchanged (see rollout notes above). Text that itself starts with the
   * envelope prefix is refused whether or not a key is set: it would be mistaken for ciphertext
   * on every later read.
   */
  encrypt(plaintext: string | null | undefined, aad = ''): string | null {
    if (plaintext === null || plaintext === undefined || plaintext.trim() === '') return null;
    if (isEncryptedEnvelope(plaintext.trim())) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_ERROR,
        `Text may not start with "${ENVELOPE_PREFIX}"`,
        HttpStatus.BAD_REQUEST,
        undefined,
        this.serviceName
      );
    }
    if (!this.masterKey) return plaintext;
    return encryptField(this.masterKey, plaintext, aad);
  }

  /**
   * Reads a stored value. Plaintext (legacy rows, or rows written while no key was set) is
   * returned as it is; an encrypted value is decrypted. Throws when an encrypted value cannot be
   * read, so ciphertext never reaches a caller as if it were text.
   */
  decrypt(stored: string | null | undefined, aad = ''): string | null {
    if (stored === null || stored === undefined || stored === '') return null;
    if (!isEncryptedEnvelope(stored)) return stored;
    if (this.readKeys.length === 0) {
      throw this.unreadable('encrypted value found but FIELD_ENCRYPTION_KEY is not configured');
    }
    try {
      return decryptField(this.readKeys, stored, aad);
    } catch {
      throw this.unreadable(
        'encrypted value could not be opened (no matching key, altered, or moved to another row)'
      );
    }
  }

  /**
   * Deterministic keyed hash for equality lookups or unique constraints on an encrypted value
   * (ciphertext is randomised, so it cannot be compared). With no key it returns the trimmed,
   * lower-cased plaintext so lookups keep working during rollout.
   */
  hash(plaintext: string | null | undefined): string | null {
    if (!plaintext || plaintext.trim() === '') return null;
    const normalised = plaintext.trim().toLowerCase();
    return this.masterKey ? hashField(this.masterKey, normalised) : normalised;
  }

  private configError(message: string): HealthcareError {
    return new HealthcareError(
      ErrorCode.CONFIGURATION_ERROR,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      undefined,
      this.serviceName
    );
  }

  private unreadable(reason: string): HealthcareError {
    void this.loggingService.log(LogType.ERROR, LogLevel.ERROR, reason, this.serviceName);
    return new HealthcareError(
      ErrorCode.INTERNAL_SERVER_ERROR,
      'A protected field could not be read',
      HttpStatus.INTERNAL_SERVER_ERROR,
      undefined,
      this.serviceName
    );
  }
}
