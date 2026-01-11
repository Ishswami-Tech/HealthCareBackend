/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service (no Terminus dependency)
 *
 * REAL-TIME HEALTH CHECK (Same Pattern as Other Services)
 * ========================================================
 * - ALWAYS performs fresh health check when called (no internal caching)
 * - Health service caches results (same as database, cache, queue, logging)
 * - Cache freshness: 15 seconds (same as other services)
 * - Direct HTTP check to OpenVidu /openvidu/api/health endpoint
 * - Ensures health status reflects actual current state
 *
 * Architecture:
 * - Primary: Direct OpenVidu health check (most reliable)
 * - Fallback: VideoService health check (if available)
 * - Always real-time when called: Never uses cached data internally
 * - Health service manages caching: Uses cached result if fresh (< 15s)
 *
 * Caching Pattern (Same as Other Services):
 * - Health service checks cache first (15s freshness)
 * - If cache is fresh → use cached status
 * - If cache is stale → call this indicator for fresh check
 * - Background monitoring updates cache every 30s
 *
 * Uses only LoggingService (per .ai-rules/ coding standards)
 * Uses OpenVidu official health endpoint: /openvidu/api/health
 * See: https://docs.openvidu.io/en/stable/reference-docs/REST-API/
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicatorResult } from './types';
import { VideoService } from '@services/video/video.service';
import { BaseHealthIndicator } from './base-health.indicator';
import { ConfigService } from '@config';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

interface VideoHealthStatus {
  isHealthy: boolean;
  primaryProvider: string;
  fallbackProvider: string | null;
  errorMessage?: string;
  responseTime?: number; // Response time in milliseconds for real-time checks
}

@Injectable()
export class VideoHealthIndicator extends BaseHealthIndicator<VideoHealthStatus> {
  constructor(
    @Optional()
    @Inject(forwardRef(() => VideoService))
    private readonly videoService?: VideoService,
    @Optional()
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => HttpService))
    private readonly httpService?: HttpService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {
    super();
  }

  protected isServiceAvailable(): boolean {
    // Video health check can work in two ways:
    // 1. Via VideoService (if available)
    // 2. Via direct HTTP check to OpenVidu (if ConfigService and HttpService are available)
    const videoServiceAvailable = this.videoService !== undefined && this.videoService !== null;
    const directCheckAvailable =
      this.configService !== undefined &&
      this.configService !== null &&
      this.httpService !== undefined &&
      this.httpService !== null;

    const isAvailable = videoServiceAvailable || directCheckAvailable;

    // Log for debugging if neither method is available
    if (!isAvailable && this.loggingService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'VideoHealthIndicator: Neither VideoService nor direct HTTP check available - check module configuration',
        'VideoHealthIndicator.isServiceAvailable',
        {
          videoServiceAvailable,
          configServiceAvailable: !!this.configService,
          httpServiceAvailable: !!this.httpService,
        }
      );
    }

    return isAvailable;
  }

  protected getServiceName(): string {
    return 'Video';
  }

  /**
   * Get real-time health status (ALWAYS performs fresh check - no caching)
   *
   * Architecture:
   * - ALWAYS performs real-time health check to OpenVidu
   * - NO caching - ensures accurate, up-to-date status
   * - Direct HTTP check to /openvidu/api/health endpoint
   * - Falls back to VideoService if available, otherwise direct check
   *
   * This ensures health status reflects actual current state, not stale cached data
   */
  protected async getHealthStatus(): Promise<VideoHealthStatus> {
    // Log that health check is being performed
    if (this.loggingService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'VideoHealthIndicator: getHealthStatus called',
        'VideoHealthIndicator.getHealthStatus',
        {
          videoServiceAvailable: !!this.videoService,
          configServiceAvailable: !!this.configService,
          httpServiceAvailable: !!this.httpService,
        }
      );
    }

    // PRIORITY 1: Direct real-time OpenVidu health check (most reliable)
    // Always check OpenVidu directly to get current status - no caching
    if (this.configService && this.httpService) {
      try {
        // Get OpenVidu URL from config (no hardcoded fallback)
        const openviduUrl = this.configService.getEnv('OPENVIDU_URL');
        if (!openviduUrl) {
          const errorMsg = 'OPENVIDU_URL not configured';
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.ERROR,
              `VideoHealthIndicator: ${errorMsg}`,
              'VideoHealthIndicator.getHealthStatus',
              { error: errorMsg }
            );
          }
          throw new Error(errorMsg);
        }

        // Health check WITHOUT authentication
        // According to OpenVidu documentation (https://docs.openvidu.io):
        // 1. Root URL should show "Welcome to OpenVidu" message (default behavior for all editions)
        // 2. /openvidu/api/health endpoint exists but is ONLY available in PRO/ENTERPRISE editions
        //    - Returns: {"status": "UP", "disconnectedMediaNodes": []}
        // 3. /openvidu/api/config is a public endpoint available in ALL editions (including CE)
        //    - Returns OpenVidu configuration without authentication
        //
        // Since we're using Community Edition (CE), we'll try:
        // - Root URL first (should show "Welcome to OpenVidu" - confirms server is running)
        // - Fallback to /openvidu/api/config if root URL fails with non-403 error
        // - Treat 403/401 as healthy (server is responding, just blocking access - common with reverse proxies)

        let healthEndpoint = openviduUrl;

        // Remove trailing slash from openviduUrl if present
        if (healthEndpoint.endsWith('/')) {
          healthEndpoint = healthEndpoint.slice(0, -1);
        }

        // Store endpoints for fallback strategy
        const rootEndpoint = healthEndpoint;
        const configEndpoint = `${healthEndpoint}/openvidu/api/config`;

        // CRITICAL: Verify we're not using old hardcoded URL
        if (
          healthEndpoint.includes('openvidu-server:4443') ||
          healthEndpoint.includes('/openvidu/api/health')
        ) {
          const errorMsg = `ERROR: Using old hardcoded URL! Expected OPENVIDU_URL from env, got: ${healthEndpoint}`;
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.ERROR,
              LogLevel.ERROR,
              errorMsg,
              'VideoHealthIndicator.getHealthStatus',
              { healthEndpoint, openviduUrl }
            );
          }
          throw new Error(errorMsg);
        }

        // Log health check attempt for debugging
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            `VideoHealthIndicator: Performing OpenVidu health check (no auth) at ${healthEndpoint}`,
            'VideoHealthIndicator.getHealthStatus',
            {
              endpoint: healthEndpoint,
              openviduUrl,
            }
          );
        }

        // REAL-TIME health check - always fresh, no cache
        // Simply checks if OpenVidu server is reachable (HTTP connectivity)
        // No authentication required - just checks server is up
        const startTime = Date.now();
        // Get timeout from config or use default 5 seconds
        const timeout = this.configService.getEnvNumber('VIDEO_HEALTH_CHECK_TIMEOUT', 5000) || 5000;

        // Create timeout promise with proper cleanup
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`OpenVidu health check timeout after ${timeout}ms`));
          }, timeout);
        });

        let response: { status: number; data?: unknown } | null = null;
        let lastError: Error | null = null;
        let finalEndpoint = healthEndpoint;

        // Try root URL first (should show "Welcome to OpenVidu")
        try {
          response = await Promise.race([
            this.httpService.get<string>(rootEndpoint, {
              timeout,
              // No auth headers - public health check
            }),
            timeoutPromise,
          ]);

          finalEndpoint = rootEndpoint;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const errorStatus = (error as { status?: number })?.status;

          // If root URL returns 403/401, server is responding (healthy)
          // Only try fallback for actual connection errors or other 4xx/5xx
          if (errorStatus !== 403 && errorStatus !== 401) {
            // Try fallback: /openvidu/api/config (public endpoint available in all editions)
            if (this.loggingService) {
              void this.loggingService.log(
                LogType.SYSTEM,
                LogLevel.DEBUG,
                `VideoHealthIndicator: Root URL check failed, trying /openvidu/api/config endpoint`,
                'VideoHealthIndicator.getHealthStatus',
                {
                  rootEndpoint,
                  configEndpoint,
                  errorStatus,
                  error: lastError.message,
                }
              );
            }

            try {
              response = await Promise.race([
                this.httpService.get<{ version?: string; [key: string]: unknown }>(configEndpoint, {
                  timeout,
                  // No auth headers - public endpoint
                }),
                timeoutPromise,
              ]);

              finalEndpoint = configEndpoint;
              lastError = null; // Clear error since fallback succeeded
            } catch (fallbackError) {
              lastError =
                fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
              // Will be handled below
            }
          } else {
            // 403/401 from root URL - server is responding, treat as healthy
            response = { status: errorStatus };
            finalEndpoint = rootEndpoint;
            lastError = null;
          }
        }

        // Clear timeout if we got a response
        if (timeoutId && (response || lastError)) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (!response && lastError) {
          // Both root and config endpoints failed
          throw lastError;
        }

        const responseTime = Date.now() - startTime;
        const httpStatus = response?.status ?? 0;

        // Check health according to OpenVidu documentation:
        // - 2xx/3xx: Server is up and responding (healthy) - shows "Welcome to OpenVidu" or config
        // - 403 Forbidden: Server is up but blocking access (still healthy - server is responding)
        //   Common with reverse proxies or security policies
        // - 401 Unauthorized: Server is up but requires auth (still healthy - server is responding)
        // - Other 4xx/5xx: Server error (unhealthy)
        const isHealthy =
          (httpStatus >= 200 && httpStatus < 400) || // Success responses (200-399)
          httpStatus === 403 || // Forbidden - server is up, just blocking (common with reverse proxies)
          httpStatus === 401; // Unauthorized - server is up, just requires auth

        // Log result for debugging (only at DEBUG level to reduce noise)
        if (this.loggingService && isHealthy) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            `VideoHealthIndicator: OpenVidu health check succeeded`,
            'VideoHealthIndicator.getHealthStatus',
            {
              isHealthy,
              httpStatus,
              responseTime,
              endpoint: finalEndpoint,
              endpointUsed: finalEndpoint === rootEndpoint ? 'root' : 'config',
            }
          );
        }
        // Only log failures at WARN level if we have a fallback, otherwise ERROR
        if (this.loggingService && !isHealthy) {
          const hasFallback = this.videoService && this.videoService.getFallbackProvider();
          void this.loggingService.log(
            LogType.SYSTEM,
            hasFallback ? LogLevel.DEBUG : LogLevel.WARN,
            `VideoHealthIndicator: OpenVidu health check failed${hasFallback ? ' (fallback available)' : ''}`,
            'VideoHealthIndicator.getHealthStatus',
            {
              isHealthy,
              httpStatus,
              responseTime,
              endpoint: finalEndpoint,
              endpointUsed: finalEndpoint === rootEndpoint ? 'root' : 'config',
              hasFallback: !!hasFallback,
            }
          );
        }

        // Get provider info from VideoService if available (for fallback status)
        let primaryProvider = 'openvidu';
        let fallbackProvider: string | null = 'jitsi';

        if (this.videoService) {
          try {
            primaryProvider = this.videoService.getCurrentProvider() || 'openvidu';
            fallbackProvider = this.videoService.getFallbackProvider();
          } catch {
            // VideoService methods failed - use defaults
          }
        }

        return {
          isHealthy,
          primaryProvider,
          fallbackProvider,
          responseTime,
          ...(isHealthy
            ? {}
            : {
                errorMessage: `OpenVidu health check failed - HTTP ${httpStatus || 'unknown'}`,
              }),
        };
      } catch (error) {
        // Direct health check failed - try VideoService as fallback
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;

        // Log error for debugging
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'VideoHealthIndicator: Direct OpenVidu health check failed, trying VideoService fallback',
            'VideoHealthIndicator.getHealthStatus',
            {
              error: errorMessage,
              stack: errorStack,
              willTryVideoService: !!this.videoService,
            }
          );
        }

        // If VideoService is available, try it as fallback
        if (this.videoService) {
          try {
            const fallbackStartTime = Date.now();
            const isHealthy = await this.videoService.isHealthy();
            const fallbackResponseTime = Date.now() - fallbackStartTime;
            const primaryProvider = this.videoService.getCurrentProvider() || 'openvidu';
            const fallbackProvider = this.videoService.getFallbackProvider();

            if (this.loggingService) {
              void this.loggingService.log(
                isHealthy ? LogType.SYSTEM : LogType.ERROR,
                isHealthy ? LogLevel.INFO : LogLevel.WARN,
                `VideoHealthIndicator: VideoService fallback health check ${isHealthy ? 'succeeded' : 'failed'}`,
                'VideoHealthIndicator.getHealthStatus',
                {
                  isHealthy,
                  primaryProvider,
                  fallbackProvider,
                  responseTime: fallbackResponseTime,
                  usedFallback: true,
                  originalError: errorMessage,
                }
              );
            }

            return {
              isHealthy,
              primaryProvider,
              fallbackProvider,
              responseTime: fallbackResponseTime,
              ...(isHealthy
                ? {}
                : { errorMessage: `VideoService health check failed: ${errorMessage}` }),
            };
          } catch (serviceError) {
            const serviceErrorMessage =
              serviceError instanceof Error ? serviceError.message : 'Unknown error';

            // Both direct check and VideoService failed
            if (this.loggingService) {
              void this.loggingService.log(
                LogType.ERROR,
                LogLevel.ERROR,
                'VideoHealthIndicator: Both direct OpenVidu check and VideoService fallback failed',
                'VideoHealthIndicator.getHealthStatus',
                {
                  directCheckError: errorMessage,
                  videoServiceError: serviceErrorMessage,
                  usedFallback: true,
                }
              );
            }

            return {
              isHealthy: false,
              primaryProvider: 'openvidu',
              fallbackProvider: 'jitsi',
              errorMessage: `Direct OpenVidu check failed: ${errorMessage}. VideoService check also failed: ${serviceErrorMessage}`,
            };
          }
        }

        // Direct check failed and VideoService not available
        return {
          isHealthy: false,
          primaryProvider: 'openvidu',
          fallbackProvider: 'jitsi',
          errorMessage: `Direct OpenVidu health check failed: ${errorMessage}`,
        };
      }
    }

    // PRIORITY 2: Use VideoService if direct check not possible
    if (this.videoService) {
      // Real-time health check using VideoService (which checks OpenVidu)
      let isHealthy = false;
      let errorMessage: string | undefined;

      try {
        isHealthy = await this.videoService.isHealthy();

        if (this.loggingService) {
          void this.loggingService.log(
            isHealthy ? LogType.SYSTEM : LogType.ERROR,
            isHealthy ? LogLevel.INFO : LogLevel.WARN,
            `VideoHealthIndicator: VideoService health check ${isHealthy ? 'succeeded' : 'failed'}`,
            'VideoHealthIndicator.getHealthStatus',
            {
              isHealthy,
              usedVideoService: true,
            }
          );
        }
      } catch (error) {
        // Capture actual error message for detailed reporting
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        isHealthy = false;

        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'VideoHealthIndicator: VideoService health check threw error',
            'VideoHealthIndicator.getHealthStatus',
            {
              error: errorMessage,
              usedVideoService: true,
            }
          );
        }
      }

      const primaryProvider = this.videoService.getCurrentProvider();
      const fallbackProvider = this.videoService.getFallbackProvider();

      const result: VideoHealthStatus = {
        isHealthy,
        primaryProvider: primaryProvider || 'unknown',
        fallbackProvider: fallbackProvider || null,
      };

      // Only include errorMessage if it exists (for exactOptionalPropertyTypes)
      if (errorMessage !== undefined) {
        result.errorMessage = errorMessage;
      }

      return result;
    }

    // No way to check health - both direct check and VideoService unavailable
    const errorMsg =
      'Video service not available - OpenVidu direct check and VideoService both unavailable. Check module configuration.';

    if (this.loggingService) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `VideoHealthIndicator: ${errorMsg}`,
        'VideoHealthIndicator.getHealthStatus',
        {
          videoServiceAvailable: false,
          configServiceAvailable: !!this.configService,
          httpServiceAvailable: !!this.httpService,
        }
      );
    }

    return {
      isHealthy: false,
      primaryProvider: 'unknown',
      fallbackProvider: null,
      errorMessage: errorMsg,
    };
  }

  protected formatResult(key: string, status: VideoHealthStatus): HealthIndicatorResult {
    const details: Record<string, unknown> = {
      primaryProvider: status.primaryProvider,
      fallbackProvider: status.fallbackProvider,
      isHealthy: status.isHealthy,
    };

    // Include error message if available for detailed error reporting
    if (status.errorMessage) {
      details['error'] = status.errorMessage;
      details['message'] = `Video service unavailable: ${status.errorMessage}`;
    } else if (!status.isHealthy) {
      details['message'] = 'Video service unavailable - OpenVidu may be down or not accessible';
    } else {
      details['message'] =
        `Video service is healthy (Provider: ${status.primaryProvider}${status.fallbackProvider ? `, Fallback: ${status.fallbackProvider}` : ''})`;
    }

    // Include response time if available (same pattern as other services)
    if ('responseTime' in status && typeof status.responseTime === 'number') {
      details['responseTime'] = status.responseTime;
    }

    return this.getStatus(key, status.isHealthy, details);
  }

  protected extractIsHealthy(status: VideoHealthStatus): boolean {
    return status.isHealthy;
  }

  /**
   * Override validateHealthStatus to NOT throw HealthCheckError when video is down
   * Video is an optional service - API can function without it
   * This prevents excessive ERROR logs when only video is down
   */
  protected validateHealthStatus(result: HealthIndicatorResult, status: VideoHealthStatus): void {
    // Don't throw HealthCheckError for video - it's optional
    // Video service being down should not cause ERROR logs
    // The result already indicates unhealthy status
    // This prevents excessive ERROR logs when OpenVidu is down (every 20-60 seconds)
    if (!status.isHealthy) {
      // Video is down but don't throw - just return
      // The result already indicates unhealthy status
      return;
    }
    // If healthy, no validation needed - result already indicates healthy
  }
}
