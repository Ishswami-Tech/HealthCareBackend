/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service using @nestjs/terminus
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

    const isHealthy = await this.videoService.isHealthy();
    const primaryProvider = this.videoService.getCurrentProvider();
    const fallbackProvider = this.videoService.getFallbackProvider();

    return {
      isHealthy,
      primaryProvider,
      fallbackProvider,
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
}
