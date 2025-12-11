/**
 * Video Health Indicator for Health Module
 * @class VideoHealthIndicator
 * @description Health indicator for video service using @nestjs/terminus
 */

import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { VideoService } from '@services/video/video.service';

@Injectable()
export class VideoHealthIndicator extends HealthIndicator {
  constructor(
    @Optional()
    @Inject(forwardRef(() => VideoService))
    private readonly videoService?: VideoService
  ) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.videoService) {
        return this.getStatus(key, true, {
          message: 'Video service not available',
        });
      }

      const isHealthy = await this.videoService.isHealthy();
      const primaryProvider = this.videoService.getCurrentProvider();
      const fallbackProvider = this.videoService.getFallbackProvider();

      const result = this.getStatus(key, isHealthy, {
        primaryProvider,
        fallbackProvider,
        isHealthy,
      });

      if (!isHealthy) {
        throw new HealthCheckError('Video service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Video service health check failed', result);
    }
  }
}
