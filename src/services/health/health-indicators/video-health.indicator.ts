/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service using @nestjs/terminus
 * Follows SOLID, DRY, and KISS principles
 *
 * NOTE: Video is an OPTIONAL service - it does NOT throw HealthCheckError when unhealthy.
 * This allows the API container to be marked healthy even when OpenVidu is down.
 * Video features will be unavailable, but core healthcare features will work.
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicatorResult } from '@nestjs/terminus';
import { VideoService } from '@services/video/video.service';
import { BaseHealthIndicator } from './base-health.indicator';

interface VideoHealthStatus {
  isHealthy: boolean;
  primaryProvider: string;
  fallbackProvider: string | null;
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
      // Video service not available - return unhealthy status without throwing
      return {
        isHealthy: false,
        primaryProvider: 'unknown',
        fallbackProvider: null,
      };
    }

    // Real-time health check - verify service is actually healthy
    const isHealthy = await this.videoService.isHealthy();
    const primaryProvider = this.videoService.getCurrentProvider();
    const fallbackProvider = this.videoService.getFallbackProvider();

    return {
      isHealthy,
      primaryProvider: primaryProvider || 'unknown',
      fallbackProvider: fallbackProvider || null,
    };
  }

  protected formatResult(key: string, status: VideoHealthStatus): HealthIndicatorResult {
    // Always return status as 'up' for Docker health check purposes
    // The isHealthy field indicates actual video service health
    // This prevents video unavailability from marking the entire API as unhealthy
    return this.getStatus(key, true, {
      status: status.isHealthy ? 'up' : 'down',
      primaryProvider: status.primaryProvider,
      fallbackProvider: status.fallbackProvider,
      isHealthy: status.isHealthy,
      note: status.isHealthy ? undefined : 'Video service unavailable - optional feature',
    });
  }

  /**
   * Override validateHealthStatus to NOT throw for video
   * Video is an OPTIONAL service - unhealthy video should NOT fail the health check
   * This allows the API to start and be marked healthy even when OpenVidu is down
   */
  protected validateHealthStatus(_result: HealthIndicatorResult, _status: VideoHealthStatus): void {
    // Do NOT throw HealthCheckError for video - it's an optional service
    // The base class would throw here, but we override to allow graceful degradation
    // Video being down should NOT mark the API container as unhealthy
  }

  protected extractIsHealthy(status: VideoHealthStatus): boolean {
    return status.isHealthy;
  }
}
