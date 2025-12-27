/**
 * Communication Resilience Service
 * ================================
 * Provides robust error handling, circuit breakers, rate limiting, and monitoring
 * for all communication channels
 *
 * @module CommunicationResilienceService
 * @description Centralized resilience service for communication system
 */

import { Injectable, Inject, forwardRef, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerService } from '@core/resilience/circuit-breaker.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LogType, LogLevel } from '@core/types';

/**
 * Provider health metrics
 */
interface ProviderHealthMetrics {
  provider: string;
  clinicId?: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  lastSuccessTime?: Date;
  lastFailureTime?: Date;
  consecutiveFailures: number;
  averageLatency: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
}

/**
 * Rate limit configuration per clinic/provider
 */
interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  burstAllowance: number;
}

/**
 * Communication Resilience Service
 * Provides circuit breakers, rate limiting, health monitoring, and graceful degradation
 */
@Injectable()
export class CommunicationResilienceService implements OnModuleInit, OnModuleDestroy {
  private readonly circuitBreakerThreshold = 5; // Open circuit after 5 failures
  private readonly circuitBreakerTimeout = 60000; // 60 seconds recovery
  private readonly healthCheckInterval = 30000; // 30 seconds
  private readonly rateLimitWindow = 60000; // 1 minute
  private healthCheckTimer?: NodeJS.Timeout;
  private providerMetrics = new Map<string, ProviderHealthMetrics>();

  // Default rate limits per provider
  private readonly defaultRateLimits: Record<string, RateLimitConfig> = {
    zeptomail: {
      maxRequests: 1000, // 1000 emails per minute
      windowMs: 60000,
      burstAllowance: 100,
    },
    aws_ses: {
      maxRequests: 1000,
      windowMs: 60000,
      burstAllowance: 100,
    },
    smtp: {
      maxRequests: 500,
      windowMs: 60000,
      burstAllowance: 50,
    },
    meta_business: {
      maxRequests: 1000, // WhatsApp messages per minute
      windowMs: 60000,
      burstAllowance: 100,
    },
    twilio: {
      maxRequests: 1000,
      windowMs: 60000,
      burstAllowance: 100,
    },
  };

  constructor(
    private readonly circuitBreakerService: CircuitBreakerService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  onModuleInit(): void {
    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      void this.performHealthChecks();
    }, this.healthCheckInterval);
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }

  /**
   * Execute operation with full resilience (circuit breaker + rate limiting + retry)
   */
  async executeWithResilience<T>(
    operation: () => Promise<T>,
    options: {
      provider: string;
      clinicId?: string;
      operationName: string;
      timeout?: number;
      maxRetries?: number;
    }
  ): Promise<T> {
    const { provider, clinicId, operationName, timeout = 30000, maxRetries = 3 } = options;
    const circuitBreakerName = clinicId
      ? `communication:${provider}:${clinicId}`
      : `communication:${provider}`;

    // Check rate limit
    const rateLimitKey = clinicId ? `rate_limit:${provider}:${clinicId}` : `rate_limit:${provider}`;
    const defaultConfig = this.defaultRateLimits['zeptomail'];
    const rateLimitConfig = this.defaultRateLimits[provider] || defaultConfig;
    if (!rateLimitConfig) {
      throw new Error(`No rate limit config for provider: ${provider}`);
    }

    const isRateLimited = await this.checkRateLimit(rateLimitKey, rateLimitConfig);
    if (isRateLimited) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        `Rate limit exceeded for ${provider}`,
        'CommunicationResilienceService',
        { provider, clinicId, operationName }
      );
      throw new Error(`Rate limit exceeded for ${provider}`);
    }

    // Wrap operation with retry logic
    const operationWithRetry = async (): Promise<T> => {
      let lastError: Error | null = null;
      const baseDelay = 1000; // 1 second

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const startTime = Date.now();
        try {
          const result = await Promise.race([
            operation(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Operation timeout after ${timeout}ms`)), timeout)
            ),
          ]);

          // Record latency for successful operation
          const latency = Date.now() - startTime;
          this.recordLatency(provider, latency, clinicId);

          return result;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const latency = Date.now() - startTime;
          this.recordLatency(provider, latency, clinicId);

          // Check if error is retryable
          if (!this.isRetryableError(lastError) || attempt === maxRetries - 1) {
            throw lastError;
          }

          // Calculate exponential backoff delay
          let delay = baseDelay * Math.pow(2, attempt);
          const errorMessage = lastError.message.toLowerCase();

          // Double delay for rate limit errors
          if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
            delay = delay * 2;
          }

          await this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.WARN,
            `Operation ${operationName} attempt ${attempt + 1} failed, retrying...`,
            'CommunicationResilienceService',
            {
              provider,
              clinicId,
              operationName,
              attempt: attempt + 1,
              maxRetries,
              error: lastError.message,
              nextRetryIn: `${delay}ms`,
            }
          );

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      throw lastError || new Error('Max retries exceeded');
    };

    // Execute with circuit breaker protection
    try {
      const result = await this.circuitBreakerService.execute(operationWithRetry, {
        name: circuitBreakerName,
        failureThreshold: this.circuitBreakerThreshold,
        recoveryTimeout: this.circuitBreakerTimeout,
        onStateChange: (state, name) => {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Circuit breaker state changed: ${state}`,
            'CommunicationResilienceService',
            { name, state, provider, clinicId }
          );
        },
      });

      // Record success
      this.recordSuccess(provider, clinicId);
      return result;
    } catch (error) {
      // Record failure
      await this.recordFailure(
        provider,
        clinicId,
        error instanceof Error ? error.message : String(error)
      );

      // If circuit breaker is open, try fallback if available
      const circuitState = this.circuitBreakerService.getState(circuitBreakerName);
      if (circuitState.isOpen) {
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.WARN,
          `Circuit breaker open for ${provider}, attempting fallback`,
          'CommunicationResilienceService',
          { provider, clinicId, operationName }
        );
      }

      throw error;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();

    // Network errors - retryable
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('enotfound')
    ) {
      return true;
    }

    // Rate limit errors - retryable
    if (
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests') ||
      errorMessage.includes('429')
    ) {
      return true;
    }

    // Server errors (5xx) - retryable
    if (
      errorMessage.includes('500') ||
      errorMessage.includes('502') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504') ||
      errorMessage.includes('server error')
    ) {
      return true;
    }

    // Client errors (4xx) - generally not retryable
    if (
      errorMessage.includes('400') ||
      errorMessage.includes('401') ||
      errorMessage.includes('403') ||
      errorMessage.includes('404') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden')
    ) {
      return false;
    }

    // Default: retry unknown errors
    return true;
  }

  /**
   * Record latency for provider
   */
  private recordLatency(provider: string, latency: number, clinicId?: string): void {
    const key = clinicId ? `${provider}:${clinicId}` : provider;
    const metrics = this.providerMetrics.get(key) || this.createMetrics(provider, clinicId);

    // Calculate running average latency
    if (metrics.totalRequests === 0) {
      metrics.averageLatency = latency;
    } else {
      // Exponential moving average for better responsiveness
      const alpha = 0.3; // Smoothing factor (30% weight to new value)
      metrics.averageLatency = alpha * latency + (1 - alpha) * metrics.averageLatency;
    }

    this.providerMetrics.set(key, metrics);
  }

  /**
   * Check rate limit for provider/clinic
   */
  private async checkRateLimit(key: string, config: RateLimitConfig): Promise<boolean> {
    try {
      const currentCount = await this.cacheService.get<number>(key);
      const count = (currentCount || 0) + 1;

      if (count > config.maxRequests + config.burstAllowance) {
        return true; // Rate limited
      }

      // Increment counter
      await this.cacheService.set(key, count, Math.ceil(config.windowMs / 1000));
      return false; // Not rate limited
    } catch (error) {
      // On cache error, allow request but log warning
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        `Rate limit check failed, allowing request`,
        'CommunicationResilienceService',
        { key, error: error instanceof Error ? error.message : String(error) }
      );
      return false; // Fail open - allow request
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(provider: string, clinicId: string | undefined, latency?: number): void {
    const key = clinicId ? `${provider}:${clinicId}` : provider;
    const metrics = this.providerMetrics.get(key) || this.createMetrics(provider, clinicId);

    metrics.totalRequests++;
    metrics.successfulRequests++;
    metrics.lastSuccessTime = new Date();
    metrics.consecutiveFailures = 0;

    // Update latency if provided
    if (latency !== undefined) {
      this.recordLatency(provider, latency, clinicId);
    }

    this.providerMetrics.set(key, metrics);

    // Update circuit breaker
    const circuitBreakerName = clinicId
      ? `communication:${provider}:${clinicId}`
      : `communication:${provider}`;
    this.circuitBreakerService.recordSuccess(circuitBreakerName);
  }

  /**
   * Record failed operation
   */
  private async recordFailure(
    provider: string,
    clinicId: string | undefined,
    error: string
  ): Promise<void> {
    const key = clinicId ? `${provider}:${clinicId}` : provider;
    const metrics = this.providerMetrics.get(key) || this.createMetrics(provider, clinicId);

    metrics.totalRequests++;
    metrics.failedRequests++;
    metrics.lastFailureTime = new Date();
    metrics.consecutiveFailures++;

    this.providerMetrics.set(key, metrics);

    // Update circuit breaker
    const circuitBreakerName = clinicId
      ? `communication:${provider}:${clinicId}`
      : `communication:${provider}`;
    this.circuitBreakerService.recordFailure(circuitBreakerName);

    // Log if consecutive failures exceed threshold
    if (metrics.consecutiveFailures >= 3) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Multiple consecutive failures for ${provider}`,
        'CommunicationResilienceService',
        {
          provider,
          clinicId,
          consecutiveFailures: metrics.consecutiveFailures,
          error,
        }
      );
    }
  }

  /**
   * Create initial metrics
   */
  private createMetrics(provider: string, clinicId?: string): ProviderHealthMetrics {
    const metrics: ProviderHealthMetrics = {
      provider,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      consecutiveFailures: 0,
      averageLatency: 0,
      circuitBreakerState: 'closed',
    };
    if (clinicId) {
      metrics.clinicId = clinicId;
    }
    return metrics;
  }

  /**
   * Get provider health metrics
   */
  getProviderMetrics(provider: string, clinicId?: string): ProviderHealthMetrics | null {
    const key = clinicId ? `${provider}:${clinicId}` : provider;
    return this.providerMetrics.get(key) || null;
  }

  /**
   * Get all provider metrics
   */
  getAllMetrics(): Map<string, ProviderHealthMetrics> {
    return new Map(this.providerMetrics);
  }

  /**
   * Perform periodic health checks
   */
  private async performHealthChecks(): Promise<void> {
    try {
      for (const [_key, metrics] of this.providerMetrics.entries()) {
        const circuitBreakerName = metrics.clinicId
          ? `communication:${metrics.provider}:${metrics.clinicId}`
          : `communication:${metrics.provider}`;

        const circuitState = this.circuitBreakerService.getState(circuitBreakerName);
        metrics.circuitBreakerState = circuitState.isOpen ? 'open' : 'closed';

        // Calculate success rate
        const successRate =
          metrics.totalRequests > 0
            ? (metrics.successfulRequests / metrics.totalRequests) * 100
            : 100;

        // Alert if success rate is low
        if (metrics.totalRequests > 10 && successRate < 80) {
          await this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.WARN,
            `Low success rate detected for ${metrics.provider}`,
            'CommunicationResilienceService',
            {
              provider: metrics.provider,
              clinicId: metrics.clinicId,
              successRate: Math.round(successRate * 100) / 100,
              totalRequests: metrics.totalRequests,
              failedRequests: metrics.failedRequests,
            }
          );
        }
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Health check failed',
        'CommunicationResilienceService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Reset metrics for provider
   */
  resetMetrics(provider: string, clinicId?: string): void {
    const key = clinicId ? `${provider}:${clinicId}` : provider;
    this.providerMetrics.delete(key);

    const circuitBreakerName = clinicId
      ? `communication:${provider}:${clinicId}`
      : `communication:${provider}`;
    this.circuitBreakerService.reset(circuitBreakerName);
  }

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(provider: string, clinicId?: string): boolean {
    const metrics = this.getProviderMetrics(provider, clinicId);
    if (!metrics || metrics.totalRequests === 0) {
      return true; // Assume healthy if no data
    }

    const successRate =
      metrics.totalRequests > 0 ? (metrics.successfulRequests / metrics.totalRequests) * 100 : 100;

    return (
      successRate >= 80 && metrics.circuitBreakerState !== 'open' && metrics.consecutiveFailures < 5
    );
  }
}
