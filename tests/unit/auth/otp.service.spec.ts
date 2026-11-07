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
import type { ReviewLoginService } from '@services/auth/core/review-login.service';

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

const createService = (
  reviewLogin: { getActive: jest.Mock } = { getActive: jest.fn().mockResolvedValue(null) }
) => {
  const mockCache = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    ttl: jest.fn(),
    increment: jest.fn(),
    // Raw pipeline used for the lockout / wrong-code counters: no lockout key (ttl -2), first
    // failure counts 1, everything else acknowledges.
    multi: jest.fn(async (commands: Array<{ command: string }>) =>
      commands.map(({ command }) => {
        if (command === 'ttl') return [null, -2];
        if (command === 'incr') return [null, 1];
        return [null, 'OK'];
      })
    ),
  };
  mockedCache.mockImplementation(() => mockCache as unknown as CacheService);

  const mockLogging = {
    log: jest.fn(),
  };
  mockedLogging.mockImplementation(() => mockLogging as unknown as LoggingService);

  const mockEmail = {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
    isEnabled: jest.fn().mockReturnValue(true),
  };
  mockedEmail.mockImplementation(() => mockEmail as unknown as EmailService);

  const mockWhatsApp = {
    sendMessage: jest.fn().mockResolvedValue({ success: true }),
    sendOTP: jest.fn().mockResolvedValue(true),
    isEnabled: jest.fn().mockReturnValue(true),
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
    reviewLogin as unknown as ReviewLoginService
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

      const result = await (
        service as unknown as {
          sendOtpEmail: (
            email: string,
            name: string,
            purpose?: string,
            clinicId?: string
          ) => Promise<OtpResult>;
        }
      ).sendOtpEmail('test@example.com', 'Test User', 'verification');

      expect(result.success).toBe(true);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('should enforce cooldown when recently requested', async () => {
      mockCache.get.mockResolvedValue('cooldown-active');
      mockCache.ttl.mockResolvedValue(120);

      const result = await (
        service as unknown as {
          sendOtpEmail: (
            email: string,
            name: string,
            purpose?: string,
            clinicId?: string
          ) => Promise<OtpResult>;
        }
      ).sendOtpEmail('test@example.com', 'Test User', 'verification');

      expect(result.success).toBe(false);
      expect(result.message).toContain('wait');
    });
  });

  describe('sendOtpPhone', () => {
    it('should send OTP via WhatsApp', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.exists.mockResolvedValue(false);

      const result = await (
        service as unknown as {
          sendOtpPhone: (phone: string, purpose?: string, clinicId?: string) => Promise<OtpResult>;
        }
      ).sendOtpPhone('+919876543210', 'verification');

      expect(result.success).toBe(true);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('logs delivery as scheduled via WhatsApp when the channel is enabled', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      (mockWhatsApp.isEnabled as jest.Mock).mockReturnValue(true);

      await (
        service as unknown as {
          sendOtpPhone: (phone: string, purpose?: string) => Promise<OtpResult>;
        }
      ).sendOtpPhone('+919000000992', 'login');

      const logging = (service as unknown as Record<string, unknown>)['loggingService'] as {
        log: jest.Mock;
      };
      const messages = logging.log.mock.calls.map(call => String(call[2]));
      expect(messages.some(m => m.startsWith('OTP delivery scheduled via WhatsApp'))).toBe(true);
      expect(messages.some(m => m.startsWith('OTP not delivered'))).toBe(false);
    });
  });

  describe('disabled channel providers', () => {
    const logMessages = (): string[] => {
      const logging = (service as unknown as Record<string, unknown>)['loggingService'] as {
        log: jest.Mock;
      };
      return logging.log.mock.calls.map(call => String(call[2]));
    };
    const flush = async (): Promise<void> => {
      await new Promise(resolve => setImmediate(resolve));
    };

    beforeEach(() => {
      mockCache.get.mockResolvedValue(null);
      mockCache.set.mockResolvedValue(undefined);
      mockCache.exists.mockResolvedValue(false);
    });

    it('WhatsApp disabled: the OTP is issued (login still works) but not reported as sent', async () => {
      (mockWhatsApp.isEnabled as jest.Mock).mockReturnValue(false);
      const result = await (
        service as unknown as {
          sendOtpPhone: (phone: string, purpose?: string) => Promise<OtpResult>;
        }
      ).sendOtpPhone('+919000000991', 'login');
      await flush();

      expect(result.success).toBe(true);
      expect(mockCache.set).toHaveBeenCalled();
      expect(mockWhatsApp.sendOTP).not.toHaveBeenCalled();
      const messages = logMessages();
      expect(messages.some(m => m.startsWith('OTP not delivered: WhatsApp disabled'))).toBe(true);
      expect(messages.some(m => m.includes('OTP sent via WhatsApp'))).toBe(false);
      expect(messages.some(m => m.includes('OTP delivery scheduled'))).toBe(false);
    });

    it('email disabled: the OTP is issued but no email send is attempted or claimed', async () => {
      (mockEmail.isEnabled as jest.Mock).mockReturnValue(false);
      const result = await (
        service as unknown as {
          sendOtpEmail: (email: string, name: string, purpose?: string) => Promise<OtpResult>;
        }
      ).sendOtpEmail('qa-991@example.test', 'QA', 'login');

      expect(result.success).toBe(true);
      expect(mockEmail.sendEmail).not.toHaveBeenCalled();
      const messages = logMessages();
      expect(messages.some(m => m.startsWith('OTP not delivered: Email disabled'))).toBe(true);
      expect(messages.some(m => m.startsWith('Email OTP sent directly'))).toBe(false);
    });
  });

  describe('verifyOtp', () => {
    it('should verify correct OTP', async () => {
      // Reads the pending code first, then the just-verified replay entry.
      mockCache.get.mockResolvedValueOnce('123456').mockResolvedValueOnce(null);
      mockCache.exists.mockResolvedValue(true);

      const result = await (
        service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }
      ).verifyOtp('test@example.com', '123456');

      expect(result.success).toBe(true);
    });

    it('should reject incorrect OTP', async () => {
      mockCache.get.mockResolvedValue('123456');
      mockCache.exists.mockResolvedValue(true);

      const result = await (
        service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }
      ).verifyOtp('test@example.com', 'wrong');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid OTP');
    });

    it('should return failure when no OTP exists', async () => {
      mockCache.get.mockResolvedValue(null);

      const result = await (
        service as unknown as { verifyOtp: (id: string, otp: string) => Promise<OtpResult> }
      ).verifyOtp('test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.message).toBe('OTP not found or expired');
    });
  });

  describe('checkOtpStatus', () => {
    it('should report OTP exists when in cache with TTL', async () => {
      mockCache.get.mockResolvedValue('123456');
      mockCache.exists.mockResolvedValue(true);
      mockCache.ttl.mockResolvedValue(300);

      const result = await (
        service as unknown as {
          checkOtpStatus: (
            id: string
          ) => Promise<{ exists: boolean; expiresIn?: number; attemptsRemaining?: number }>;
        }
      ).checkOtpStatus('test@example.com');

      expect(result.exists).toBe(true);
      expect(result.expiresIn).toBe(300);
    });

    it('should report OTP does not exist when not in cache', async () => {
      mockCache.get.mockResolvedValue(null);
      mockCache.exists.mockResolvedValue(false);
      mockCache.ttl.mockResolvedValue(-1);

      const result = await (
        service as unknown as {
          checkOtpStatus: (
            id: string
          ) => Promise<{ exists: boolean; expiresIn?: number; attemptsRemaining?: number }>;
        }
      ).checkOtpStatus('test@example.com');

      expect(result.exists).toBe(false);
    });
  });

  describe('invalidateOtp', () => {
    it('should invalidate OTP by deleting cache key', async () => {
      mockCache.del.mockResolvedValue(1);

      const result = await (
        service as unknown as { invalidateOtp: (id: string) => Promise<boolean> }
      ).invalidateOtp('test@example.com');

      expect(result).toBe(true);
      expect(mockCache.del).toHaveBeenCalledWith(expect.stringContaining('otp:test@example.com'));
    });
  });

  describe('consumeOtp', () => {
    it('should consume and invalidate OTP', async () => {
      mockCache.del.mockResolvedValue(1);

      const result = await (
        service as unknown as { consumeOtp: (id: string) => Promise<boolean> }
      ).consumeOtp('test@example.com');

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

  describe('issueReviewLoginOtp', () => {
    const reviewPhone = '+919000000001';
    const reviewOtp = '482915';

    const setup = (
      active: { phone: string; otp: string } | null = { phone: reviewPhone, otp: reviewOtp }
    ) => {
      const getActive = jest.fn().mockResolvedValue(active);
      const review = createService({ getActive });
      const svcAny = review as unknown as Record<string, unknown>;
      return {
        review,
        getActive,
        cache: svcAny['cacheService'] as unknown as {
          get: jest.Mock;
          set: jest.Mock;
          del: jest.Mock;
          multi: jest.Mock;
        },
        whatsApp: svcAny['whatsAppService'] as unknown as { sendOTP: jest.Mock },
        logging: svcAny['loggingService'] as unknown as { log: jest.Mock },
      };
    };

    it('is off when no review login is live', async () => {
      const { review, cache } = setup(null);

      await expect(review.issueReviewLoginOtp(reviewPhone)).resolves.toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('ignores every other number', async () => {
      const { review, cache } = setup();

      await expect(review.issueReviewLoginOtp('+919000000002')).resolves.toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('reads the setting on every request, so changes apply at once', async () => {
      const { review, getActive } = setup();

      await review.issueReviewLoginOtp(reviewPhone);
      await review.issueReviewLoginOtp(reviewPhone);

      expect(getActive).toHaveBeenCalledTimes(2);
    });

    it('falls back to a normal OTP when the lookup fails', async () => {
      const { review, getActive, cache, logging } = setup();
      getActive.mockRejectedValue(new Error('db down'));

      await expect(review.issueReviewLoginOtp(reviewPhone)).resolves.toBeNull();
      expect(cache.set).not.toHaveBeenCalled();
      expect(JSON.stringify(logging.log.mock.calls)).toContain('Review login lookup failed');
    });

    it('stores the review code for the review number without delivering anything', async () => {
      const { review, cache, whatsApp } = setup();

      const result = await review.issueReviewLoginOtp(reviewPhone);

      expect(result).toMatchObject({ success: true });
      expect(result).not.toHaveProperty('otp');
      expect(cache.set).toHaveBeenCalledWith(
        `otp:${reviewPhone}`,
        expect.objectContaining({ otp: reviewOtp }),
        expect.any(Number)
      );
      expect(whatsApp.sendOTP).not.toHaveBeenCalled();
    });

    it('matches the review number in any format', async () => {
      const { review } = setup();

      await expect(review.issueReviewLoginOtp('90000 00001')).resolves.toMatchObject({
        success: true,
      });
    });

    it('accepts the review code through the normal verify path', async () => {
      const { review, cache } = setup();
      cache.get.mockImplementation(async (key: string) =>
        key === `otp:${reviewPhone}` ? { otp: reviewOtp } : null
      );

      await expect(review.verifyOtp(reviewPhone, reviewOtp)).resolves.toMatchObject({
        success: true,
      });
    });

    it('counts a wrong code like any other OTP', async () => {
      const { review, cache } = setup();
      cache.get.mockImplementation(async (key: string) =>
        key === `otp:${reviewPhone}` ? { otp: reviewOtp } : null
      );

      await expect(review.verifyOtp(reviewPhone, '000000')).resolves.toMatchObject({
        success: false,
        message: 'Invalid OTP',
      });
      expect(cache.multi).toHaveBeenCalledWith(
        expect.arrayContaining([{ command: 'incr', args: [`otp_verify_failures:${reviewPhone}`] }])
      );
    });

    it('stays locked out after too many wrong codes', async () => {
      const { review, cache } = setup();
      cache.multi.mockImplementation(async () => [[null, 600]]);

      await expect(review.issueReviewLoginOtp(reviewPhone)).resolves.toMatchObject({
        success: false,
        rateLimited: true,
      });
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('never writes the review code or number to the logs', async () => {
      const { review, cache, logging } = setup();
      cache.get.mockResolvedValue(null);

      await review.issueReviewLoginOtp(reviewPhone);

      const logged = JSON.stringify(logging.log.mock.calls);
      expect(logged).toContain('Review login code issued');
      expect(logged).not.toContain(reviewOtp);
      expect(logged).not.toContain(reviewPhone);
    });
  });
});
