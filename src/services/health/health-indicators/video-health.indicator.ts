/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service (no Terminus dependency)
 * Uses only LoggingService (per .ai-rules/ coding standards)
 * Uses OpenVidu official health endpoint: /openvidu/api/health
 * See: https://docs.openvidu.io/en/stable/reference-docs/REST-API/
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicatorResult } from './types';
import { VideoService } from '@services/video/video.service';
import { BaseHealthIndicator } from './base-health.indicator';

interface VideoHealthStatus {
  isHealthy: boolean;
  primaryProvider: string;
  fallbackProvider: string | null;
  errorMessage?: string;
}

@Injectable()
export class VideoHealthIndicator extends BaseHealthIndicator<VideoHealthStatus> {
  constructor(
    @Optional()
    @Inject(forwardRef(() => VideoService))
    private readonly videoService?: VideoService
  ) {
    super();
  }

  protected isServiceAvailable(): boolean {
    return this.videoService !== undefined && this.videoService !== null;
  }

  protected getServiceName(): string {
    return 'Video';
  }

  protected async getHealthStatus(): Promise<VideoHealthStatus> {
    if (!this.videoService) {
      throw new Error('Video service not available');
    }

    // Real-time health check using OpenVidu /openvidu/api/health endpoint
    // Capture error details if health check fails
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
      details['message'] = 'Video service is healthy';
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
