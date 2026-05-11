/**
 * Video Provider Factory
 * @class VideoProviderFactory
 * @description Factory for the single backend video provider abstraction
 *
 * Cloudflare Realtime is the primary runtime provider. Daily and Google Meet
 * remain available as failover adapters so the backend can keep joining calls
 * when the preferred provider is down.
 */

import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import type { IVideoProvider, VideoProviderType } from '@core/types/video.types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { CloudflareRealtimeProvider } from '@services/video/providers/cloudflare-realtime.provider';
import { DailyVideoProvider } from '@services/video/providers/daily-video.provider';
import { GoogleMeetProvider } from '@services/video/providers/google-meet.provider';

/**
 * Video provider factory
 */
@Injectable()
export class VideoProviderFactory {
  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => CloudflareRealtimeProvider))
    private readonly cloudflareProvider: CloudflareRealtimeProvider,
    @Inject(forwardRef(() => DailyVideoProvider))
    private readonly dailyProvider: DailyVideoProvider,
    @Inject(forwardRef(() => GoogleMeetProvider))
    private readonly googleMeetProvider: GoogleMeetProvider,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  private getProviderOrder(primary?: string | null): IVideoProvider[] {
    const providers = {
      cloudflare: this.cloudflareProvider,
      daily: this.dailyProvider,
      'google-meet': this.googleMeetProvider,
    } as const;

    switch (
      String(primary || '')
        .trim()
        .toLowerCase()
    ) {
      case 'daily':
        return [providers.daily, providers['google-meet'], providers.cloudflare];
      case 'google-meet':
        return [providers['google-meet'], providers.cloudflare, providers.daily];
      case 'cloudflare':
      default:
        return [providers.cloudflare, providers.daily, providers['google-meet']];
    }
  }

  getProvidersInOrder(preferredProvider?: VideoProviderType | null): IVideoProvider[] {
    const providerType = preferredProvider || this.configService.getVideoProvider();
    const ordered = this.getProviderOrder(providerType);

    return ordered.filter(provider => Boolean(provider && provider.isEnabled()));
  }

  /**
   * Get the configured video provider.
   * The current runtime supports Cloudflare Realtime with Daily and Google Meet failover.
   */
  getProvider(preferredProvider?: VideoProviderType | null): IVideoProvider {
    if (!this.configService.isVideoEnabled()) {
      throw new Error(
        'Video service is not enabled. Please enable VIDEO_ENABLED in configuration.'
      );
    }

    const provider = this.getProvidersInOrder(preferredProvider)[0];
    if (provider) {
      return provider;
    }

    throw new Error(
      'No enabled video providers are available. Check CLOUDFLARE, DAILY, and GOOGLE MEET configuration.'
    );
  }

  /**
   * Get primary provider.
   */
  getPrimaryProvider(preferredProvider?: VideoProviderType | null): IVideoProvider {
    return this.getProvider(preferredProvider);
  }

  /**
   * Get fallback provider.
   * Returns the next provider in the configured fallback order.
   */
  getFallbackProvider(preferredProvider?: VideoProviderType | null): IVideoProvider {
    const providers = this.getProvidersInOrder(preferredProvider);
    if (providers.length >= 2) {
      return providers[1]!;
    }
    if (providers[0]) {
      return providers[0];
    }
    throw new Error('No fallback video provider is available.');
  }

  /**
   * Get provider with health check and automatic failover.
   */
  async getProviderWithFallback(
    preferredProvider?: VideoProviderType | null
  ): Promise<IVideoProvider> {
    const preferredOrder = this.getProvidersInOrder(preferredProvider);

    if (preferredOrder.length === 0) {
      throw new Error(
        'No enabled video providers are available. Check CLOUDFLARE, DAILY, and GOOGLE MEET configuration.'
      );
    }

    for (const provider of preferredOrder) {
      try {
        const isHealthy = await provider.isHealthy();
        if (isHealthy) {
          return provider;
        }

        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Video provider '${provider.providerName}' is unhealthy. Trying next provider if available.`,
            'VideoProviderFactory.getProviderWithFallback',
            { provider: provider.providerName, healthStatus: 'unhealthy' }
          );
        }
      } catch (error) {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Video provider '${provider.providerName}' health check failed: ${error instanceof Error ? error.message : 'Unknown error'}. Trying next provider if available.`,
            'VideoProviderFactory.getProviderWithFallback',
            {
              provider: provider.providerName,
              error: error instanceof Error ? error.message : 'Unknown',
            }
          );
        }
      }
    }

    return preferredOrder[0]!;
  }
}
