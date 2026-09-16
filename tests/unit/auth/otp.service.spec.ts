/**
 * Unit tests for OtpService
 */

import { OtpService } from '@services/auth/core/otp.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EmailService } from '@communication/channels/email/email.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { QueueService } from '@infrastructure/queue';
import { EventService } from '@infrastructure/events/event.service';
import { ConfigService } from '@config/config.service';
import { OtpResult } from '@core/types/auth.types';

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
jest.mock('@infrastructure/http');
jest.mock('@infrastructure/database');
jest.mock('@communication/adapters/factories/provider.factory');
jest.mock('@communication/services/clinic-template.service');
jest.mock('@infrastructure/cache/cache.service');
jest.mock('@infrastructure/logging/logging.service');
jest.mock('@communication/channels/email/email.service');
jest.mock('@communication/channels/whatsapp/whatsapp.service');
jest.mock('@infrastructure/queue');
jest.mock('@infrastructure/events/event.service');
jest.mock('@config/config.service');

const mockedCache = CacheService as jest.MockedClass<typeof CacheService>;
const mockedLogging = LoggingService as jest.MockedClass<typeof LoggingService>;
const mockedEmail = EmailService as jest.MockedClass<typeof EmailService>;
const mockedWhatsApp = WhatsAppService as jest.MockedClass<typeof WhatsAppService>;
const mockedQueue = QueueService as jest.MockedClass<typeof QueueService>;
const mockedEvent = EventService as jest.MockedClass<typeof EventService>;
const mockedConfig = ConfigService as jest.MockedClass<typeof ConfigService>;

const createService = () => {
  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    ttl: jest.fn(),
    increment: jest.fn(),
  };
  mockedCache.mockImplementation(() => mockCache as unknown as CacheService);

  const mockLogging = {
    log: jest.fn(),
  };
  mockedLogging.mockImplementation(() => mockLogging as unknown as LoggingService);

  const mockEmail = {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
  };
  mockedEmail.mockImplementation(() => mockEmail as unknown as EmailService);

  const mockWhatsApp = {
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
  };
  mockedWhatsApp.mockImplementation(() => mockWhatsApp as unknown as WhatsAppService);

  const mockQueue = {
    addJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  mockedQueue.mockImplementation(() => mockQueue as unknown as QueueService);

  const mockEvent = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitEnterprise: jest.fn().mockResolvedValue(undefined),
  };
  mockedEvent.mockImplementation(() => mockEvent as unknown as EventService);

  const mockConfig = {
    get: jest.fn().mockReturnValue(6),
    getEnv: jest.fn(),
    getEnvNumber: jest.fn().mockReturnValue(6),
    getEnvBoolean: jest.fn().mockReturnValue(false),
    getAppConfig: jest.fn(),
    isDevelopment: jest.fn().mockReturnValue(false),
    isProduction: jest.fn().mockReturnValue(true),
  };
  mockedConfig.mockImplementation(() => mockConfig as unknown as ConfigService);

  return new OtpService(
    mockCache as unknown as CacheService,
    mockEmail as unknown as EmailService,
    mockQueue as unknown as QueueService,
    mockWhatsApp as unknown as WhatsAppService,
    mockConfig as unknown as ConfigService,
    mockEvent as unknown as EventService,
    mockLogging as unknown as LoggingService,
  );
};

describe('OtpService', () => {
  let service: OtpService;
  let mockCache: jest.Mocked<CacheService>;
  let mockEmail: jest.Mocked<EmailService>;
  let mockWhatsApp: jest.Mocked<WhatsAppService>;
  let mockConfig: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();

    const svcAny = service as unknown as Record<string, unknown>;
    mockCache = svcAny['cacheService'] as jest.Mocked<CacheService>;
    mockEmail = svcAny['emailService'] as jest.Mocked<EmailService>;
    mockWhatsApp = svcAny['whatsAppService'] as jest.Mocked<WhatsAppService>;
    mockConfig = svcAny['configService'] as jest.Mocked<ConfigService>;
  });

  describe('sendOtpEmail', () => {
    it('should send OTP via email when not in cooldown', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.exists.mockResolvedValue(false);

      const result = await (service as unknown as { sendOtpEmail: (email: string, name: string, purpose?: string, clinicId?: string) => Promise<OtpResult> }).sendOtpEmail('test@example.com', 'Test User', 'verification');

      expect(result.success).toBe(true);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('should enforce cooldown when recently requested', async () => {
      mockCache.get.mockResolvedValue('cooldown-active');
      mockCache.ttl.mockResolvedValue(120);

      const result = await (service as unknown as { sendOtpEmail: (email: string, name: string, purpose?: string, clinicId?: string) => Promise<OtpResult> }).sendOtpEmail('test@example.com', 'Test User', 'verification');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wait');
    });
  });

  describe('sendOtpSms', () => {
    it('should send OTP via SMS', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.exists.mockResolvedValue(false);

      const result = await (service as unknown as { sendOtpSms: (phone: string, purpose?: string, clinicId?: string) => Promise<OtpResult> }).sendOtpSms('+919876543210', 'verification');

      expect(result.success).toBe(true);
    });
  });

  describe('verifyOtp', () => {
    it('should verify correct OTP', async () => {
      mockCache.get.mockResolvedValueOnce(null).mockResolvedValueOnce('123456');
      mockCache.exists.mockResolvedValue(true);

      const result = await (service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }).verifyOtp('test@example.com', '123456');

      expect(result.success).toBe(true);
    });

    it('should reject incorrect OTP', async () => {
      mockCache.get.mockResolvedValue('123456');
      mockCache.exists.mockResolvedValue(true);

      const result = await (service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }).verifyOtp('test@example.com', 'wrong');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid OTP');
    });

    it('should return failure when no OTP exists', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await (service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }).verifyOtp('test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.message).toBe('OTP not found or expired');
    });
  });

  describe('checkOtpStatus', () => {
    it('should report OTP exists when in cache with TTL', async () => {
      mockCache.get.mockResolvedValue('123456');
      mockCache.exists.mockResolvedValue(true);
      mockCache.ttl.mockResolvedValue(300);

      const result = await (service as unknown as { checkOtpStatus: (id: string) => Promise<{ exists: boolean; expiresIn?: number; attemptsRemaining?: number }> }).checkOtpStatus('test@example.com');

      expect(result.exists).toBe(true);
      expect(result.expiresIn).toBe(300);
    });

    it('should report OTP does not exist when not in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.exists.mockResolvedValue(false);
      mockCache.ttl.mockResolvedValue(-1);

      const result = await (service as unknown as { checkOtpStatus: (id: string) => Promise<{ exists: boolean; expiresIn?: number; attemptsRemaining?: number }> }).checkOtpStatus('test@example.com');

      expect(result.exists).toBe(false);
    });
  });

  describe('invalidateOtp', () => {
    it('should invalidate OTP by deleting cache key', async () => {
      mockCache.del.mockResolvedValue(1);

      const result = await (service as unknown as { invalidateOtp: (id: string) => Promise<boolean> }).invalidateOtp('test@example.com');

      expect(result).toBe(true);
      expect(mockCache.del).toHaveBeenCalledWith(expect.stringContaining('otp:test@example.com'));
    });
  });

  describe('consumeOtp', () => {
    it('should consume and invalidate OTP', async () => {
      mockCache.del.mockResolvedValue(1);

      const result = await (service as unknown as { consumeOtp: (id: string) => Promise<boolean> }).consumeOtp('test@example.com');

      expect(result).toBe(true);
      expect(mockCache.del).toHaveBeenCalled();
    });
  });

  describe('generateOtp', () => {
    it('should generate a 6-digit OTP', () => {
      const otp = (service as unknown as { generateOtp: () => string }).generateOtp();

      expect(otp).toMatch(/^\d{6}$/);
    });

    it('should generate different OTPs on each call', () => {
      const otp1 = (service as unknown as { generateOtp: () => string }).generateOtp();
      const otp2 = (service as unknown as { generateOtp: () => string }).generateOtp();

      expect(otp1).not.toBe(otp2);
    });
  });
});
