/**
 * Unit tests for PasswordService
 */

import { PasswordService } from '@services/auth/core/password.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

jest.mock('@infrastructure/logging/logging.service');

const mockedLogging = LoggingService as jest.MockedClass<typeof LoggingService>;

describe('PasswordService', () => {
  let service: PasswordService;
  let mockLogging: jest.Mocked<LoggingService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLogging = {
      log: jest.fn(),
    } as unknown as jest.Mocked<LoggingService>;
    mockedLogging.mockImplementation(() => mockLogging);
    service = new PasswordService(mockLogging);
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const result = await service.hashPassword('mySecurePassword');

      expect(result).toBeDefined();
      expect(result).not.toBe('mySecurePassword');
      expect(result.startsWith('$2b$')).toBe(true);
      expect(result.length).toBeGreaterThan(20);
    });

    it('should produce different hashes for the same password (salt)', async () => {
      const hash1 = await service.hashPassword('samePassword');
      const hash2 = await service.hashPassword('samePassword');

      expect(hash1).not.toBe(hash2);
    });

    it('should hash empty string', async () => {
      const result = await service.hashPassword('');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle very long passwords', async () => {
      const longPassword = 'a'.repeat(72);
      const result = await service.hashPassword(longPassword);

      expect(result).toBeDefined();
      expect(result.startsWith('$2b$')).toBe(true);
    });
  });

  describe('comparePassword', () => {
    it('should return true for matching password and hash', async () => {
      const hash = await service.hashPassword('correctPassword');

      const result = await service.comparePassword('correctPassword', hash);

      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const hash = await service.hashPassword('correctPassword');

      const result = await service.comparePassword('wrongPassword', hash);

      expect(result).toBe(false);
    });

    it('should return false for empty password against hash', async () => {
      const hash = await service.hashPassword('somePassword');

      const result = await service.comparePassword('', hash);

      expect(result).toBe(false);
    });

    it('should return false for wrong hash format', async () => {
      const result = await service.comparePassword('password', 'not-a-valid-hash');

      expect(result).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('should reject password shorter than 8 characters', () => {
      const result = service.validatePasswordStrength('short');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('at least 8 characters'))).toBe(true);
    });

    it('should reject password without uppercase', () => {
      const result = service.validatePasswordStrength('lowercase123!');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('uppercase'))).toBe(true);
    });

    it('should reject password without lowercase', () => {
      const result = service.validatePasswordStrength('UPPERCASE123!');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('lowercase'))).toBe(true);
    });

    it('should reject password without numbers', () => {
      const result = service.validatePasswordStrength('NoNumbers!Aa');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('number'))).toBe(true);
    });

    it('should reject password without special characters', () => {
      const result = service.validatePasswordStrength('NoSpecial1Aa');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('special character'))).toBe(true);
    });

    it('should accept a strong password', () => {
      const result = service.validatePasswordStrength('SecureP@ssw0rd!');

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('should flag common passwords', () => {
      const result = service.validatePasswordStrength('Password123!');

      expect(result.isValid).toBe(false);
      expect(result.score).toBeLessThan(100);
    });

    it('should flag sequential characters', () => {
      const result = service.validatePasswordStrength('abc123!Aa');

      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('sequential'))).toBe(true);
    });

    it('should flag repeated characters', () => {
      const result = service.validatePasswordStrength('aaaaa111!!!');

      expect(result.isValid).toBe(false);
    });

    it('should return score between 0 and 100', () => {
      const result = service.validatePasswordStrength('whatever123');

      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('getPasswordStrength', () => {
    it('should return score and feedback', () => {
      const result = service.getPasswordStrength('weak');

      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('feedback');
      expect(result).toHaveProperty('suggestions');
      expect(Array.isArray(result.feedback)).toBe(true);
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should suggest improvements for weak password', () => {
      const result = service.getPasswordStrength('short');

      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('generateSecurePassword', () => {
    it('should generate a password of default length 16', () => {
      const password = service.generateSecurePassword();

      expect(password.length).toBe(16);
    });

    it('should generate a password of specified length', () => {
      const password = service.generateSecurePassword(32);

      expect(password.length).toBe(32);
    });

    it('should contain uppercase, lowercase, numbers, and symbols', () => {
      const password = service.generateSecurePassword(16);

      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/[0-9]/.test(password)).toBe(true);
      expect(/[^A-Za-z0-9]/.test(password)).toBe(true);
    });

    it('should generate different passwords each call', () => {
      const p1 = service.generateSecurePassword();
      const p2 = service.generateSecurePassword();

      expect(p1).not.toBe(p2);
    });
  });

  describe('error handling', () => {
    it('should handle hashPassword gracefully', async () => {
      const result = await service.hashPassword('test-password');

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});
