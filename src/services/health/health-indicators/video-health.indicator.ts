/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service using @nestjs/terminus
 * Uses OpenVidu official health endpoint: /openvidu/api/health
 * See: https://docs.openvidu.io/en/stable/reference-docs/REST-API/
 * Follows SOLID, DRY, and KISS principles
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
      throw new Error('Video service not available');
    }

    // Real-time health check using OpenVidu /openvidu/api/health endpoint
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
    return this.getStatus(key, status.isHealthy, {
      primaryProvider: status.primaryProvider,
      fallbackProvider: status.fallbackProvider,
      isHealthy: status.isHealthy,
    });
  }

  protected extractIsHealthy(status: VideoHealthStatus): boolean {
    return status.isHealthy;
  }

  /**
   * Override validateHealthStatus to NOT throw HealthCheckError when video is down
   * Video is an optional service - API can function without it
   * This prevents Terminus from logging ERROR when only video is down
   */
  protected validateHealthStatus(result: HealthIndicatorResult, status: VideoHealthStatus): void {
    // Don't throw HealthCheckError for video - it's optional
    // Video service being down should not cause ERROR logs
    // The result already indicates unhealthy status, which Terminus will handle gracefully
    // This prevents excessive ERROR logs when OpenVidu is down (every 20-60 seconds)
    if (!status.isHealthy) {
      // Video is down but don't throw - just return
      // Terminus will see the unhealthy status in the result but won't log as ERROR
      return;
    }
    // If healthy, no validation needed - result already indicates healthy
  }
}
