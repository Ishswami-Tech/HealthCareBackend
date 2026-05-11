import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { HealthIndicatorResult } from './types';
import { VideoService } from '@services/video/video.service';
import { BaseHealthIndicator } from './base-health.indicator';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

interface VideoHealthStatus {
  isHealthy: boolean;
  primaryProvider: string;
  fallbackProvider: string | null;
  errorMessage?: string;
  responseTime?: number;
}

@Injectable()
export class VideoHealthIndicator extends BaseHealthIndicator<VideoHealthStatus> {
  constructor(
    @Optional()
    @Inject(forwardRef(() => VideoService))
    private readonly videoService?: VideoService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
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
      const errorMessage = 'Video service not available';
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `VideoHealthIndicator: ${errorMessage}`,
          'VideoHealthIndicator.getHealthStatus',
          {}
        );
      }

      return {
        isHealthy: false,
        primaryProvider: 'unknown',
        fallbackProvider: null,
        errorMessage,
      };
    }

    const startTime = Date.now();

    try {
      const isHealthy = await this.videoService.isHealthy();
      const primaryProvider = this.videoService.getCurrentProvider() || 'unknown';
      const fallbackProvider = this.videoService.getFallbackProvider() || null;

      return {
        isHealthy,
        primaryProvider,
        fallbackProvider,
        responseTime: Date.now() - startTime,
        ...(isHealthy
          ? {}
          : {
              errorMessage: 'Video provider is unavailable',
            }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'VideoHealthIndicator: health check failed',
          'VideoHealthIndicator.getHealthStatus',
          { error: errorMessage }
        );
      }

      return {
        isHealthy: false,
        primaryProvider: this.videoService.getCurrentProvider() || 'unknown',
        fallbackProvider: this.videoService.getFallbackProvider() || null,
        errorMessage: `Video health check failed: ${errorMessage}`,
        responseTime: Date.now() - startTime,
      };
    }
  }

  protected formatResult(key: string, status: VideoHealthStatus): HealthIndicatorResult {
    const details: Record<string, unknown> = {
      primaryProvider: status.primaryProvider,
      fallbackProvider: status.fallbackProvider,
      isHealthy: status.isHealthy,
    };

    if (status.errorMessage) {
      details['error'] = status.errorMessage;
      details['message'] = `Video service unavailable: ${status.errorMessage}`;
    } else if (!status.isHealthy) {
      details['message'] = 'Video service unavailable';
    } else {
      details['message'] =
        `Video service is healthy (Provider: ${status.primaryProvider}${status.fallbackProvider ? `, Fallback: ${status.fallbackProvider}` : ''})`;
    }

    if ('responseTime' in status && typeof status.responseTime === 'number') {
      details['responseTime'] = status.responseTime;
    }

    return this.getStatus(key, status.isHealthy, details);
  }

  protected extractIsHealthy(status: VideoHealthStatus): boolean {
    return status.isHealthy;
  }

  protected validateHealthStatus(result: HealthIndicatorResult, status: VideoHealthStatus): void {
    if (!status.isHealthy) {
      return;
    }
  }
}
