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
    private readonly httpService?: HttpService
  ) {
    super();
  }

  protected isServiceAvailable(): boolean {
    const isAvailable = this.videoService !== undefined && this.videoService !== null;
    // Log for debugging if service is not available
    if (!isAvailable) {
      // Use console.error as fallback since LoggingService might not be available
      // This helps diagnose module injection issues
      console.error(
        '[VideoHealthIndicator] VideoService not available - check module configuration and circular dependencies'
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
    // PRIORITY 1: Direct real-time OpenVidu health check (most reliable)
    // Always check OpenVidu directly to get current status - no caching
    if (this.configService && this.httpService) {
      try {
        const openviduUrl =
          this.configService.getEnv('OPENVIDU_URL') || 'http://openvidu-server:4443';
        const openviduSecret = this.configService.getEnv('OPENVIDU_SECRET') || '';
        const healthEndpoint = `${openviduUrl}/openvidu/api/health`;

        // REAL-TIME health check - always fresh, no cache
        // Uses official OpenVidu health endpoint: /openvidu/api/health
        // See: https://docs.openvidu.io/en/stable/reference-docs/REST-API/
        const startTime = Date.now();
        const response = await Promise.race([
          this.httpService.get<{ status: string }>(healthEndpoint, {
            timeout: 5000, // 5 second timeout for real-time check
            headers: openviduSecret
              ? {
                  Authorization: `Basic ${Buffer.from(`OPENVIDUAPP:${openviduSecret}`).toString('base64')}`,
                }
              : {},
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('OpenVidu health check timeout')), 5000)
          ),
        ]);

        const responseTime = Date.now() - startTime;
        const isHealthy = response?.data?.status === 'UP';

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
          ...(isHealthy
            ? {}
            : {
                errorMessage: `OpenVidu reports status: ${response?.data?.status || 'unknown'}`,
                responseTime,
              }),
        };
      } catch (error) {
        // Direct health check failed - try VideoService as fallback
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // If VideoService is available, try it as fallback
        if (this.videoService) {
          try {
            const isHealthy = await this.videoService.isHealthy();
            const primaryProvider = this.videoService.getCurrentProvider() || 'openvidu';
            const fallbackProvider = this.videoService.getFallbackProvider();

            return {
              isHealthy,
              primaryProvider,
              fallbackProvider,
              ...(isHealthy
                ? {}
                : { errorMessage: `VideoService health check failed: ${errorMessage}` }),
            };
          } catch (serviceError) {
            // Both direct check and VideoService failed
            return {
              isHealthy: false,
              primaryProvider: 'openvidu',
              fallbackProvider: 'jitsi',
              errorMessage: `Direct OpenVidu check failed: ${errorMessage}. VideoService check also failed: ${serviceError instanceof Error ? serviceError.message : 'Unknown error'}`,
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
      } catch (error) {
        // Capture actual error message for detailed reporting
        errorMessage = error instanceof Error ? error.message : 'Unknown error';
        isHealthy = false;
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
    return {
      isHealthy: false,
      primaryProvider: 'unknown',
      fallbackProvider: null,
      errorMessage:
        'Video service not available - OpenVidu direct check and VideoService both unavailable. Check module configuration.',
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
