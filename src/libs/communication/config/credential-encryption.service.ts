/**
 * Credential Encryption Service
 * =============================
 * Encrypts and decrypts sensitive communication provider credentials
 * Uses AES-256-GCM for encryption with key rotation support
 *
 * @module CredentialEncryptionService
 * @description Secure credential management for multi-tenant communication
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@config';
import * as crypto from 'crypto';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Encryption Algorithm
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // 512 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const ITERATIONS = 100000; // PBKDF2 iterations

/**
 * Credential Encryption Service
 * Provides secure encryption/decryption of credentials
 */
@Injectable()
export class CredentialEncryptionService {
  private readonly logger = new Logger(CredentialEncryptionService.name);
  private readonly encryptionKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {
    // Get encryption key from environment or generate one (for development)
    this.encryptionKey =
      this.configService.get<string>('COMMUNICATION_ENCRYPTION_KEY') ||
      this.configService.get<string>('ENCRYPTION_KEY') ||
      'default-key-change-in-production';

    if (this.encryptionKey === 'default-key-change-in-production') {
      this.logger.warn('Using default encryption key. Change in production!');
    }
  }

  /**
   * Encrypt sensitive credential data
   */
  async encrypt(plaintext: string): Promise<string> {
    try {
      // Generate random salt
      const salt = crypto.randomBytes(SALT_LENGTH);

      // Derive key from master key and salt
      const key = crypto.pbkdf2Sync(this.encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');

      // Generate random IV
      const iv = crypto.randomBytes(IV_LENGTH);

      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      // Encrypt
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get authentication tag
      const tag = cipher.getAuthTag();

      // Combine salt + iv + tag + encrypted data
      const combined = Buffer.concat([salt, iv, tag, Buffer.from(encrypted, 'hex')]).toString(
        'base64'
      );

      return combined;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to encrypt credential: ${error instanceof Error ? error.message : String(error)}`,
        'CredentialEncryptionService',
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Decrypt sensitive credential data
   */
  async decrypt(encryptedData: string): Promise<string> {
    try {
      // Decode from base64
      const combined = Buffer.from(encryptedData, 'base64');

      // Extract components
      const salt = combined.subarray(0, SALT_LENGTH);
      const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

      // Derive key from master key and salt
      const key = crypto.pbkdf2Sync(this.encryptionKey, salt, ITERATIONS, KEY_LENGTH, 'sha512');

      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      // Decrypt
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to decrypt credential: ${error instanceof Error ? error.message : String(error)}`,
        'CredentialEncryptionService',
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Encrypt an object (useful for credential objects)
   */
  async encryptObject<T extends Record<string, unknown>>(obj: T): Promise<string> {
    const json = JSON.stringify(obj);
    return await this.encrypt(json);
  }

  /**
   * Decrypt an object
   */
  async decryptObject<T extends Record<string, unknown>>(encryptedData: string): Promise<T> {
    const decrypted = await this.decrypt(encryptedData);
    return JSON.parse(decrypted) as T;
  }
}
