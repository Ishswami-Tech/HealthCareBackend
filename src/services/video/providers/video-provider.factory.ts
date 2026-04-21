/**
 * Video Provider Factory
 * @class VideoProviderFactory
 * @description Factory for the single backend video provider abstraction
 *
 * OpenVidu is the primary runtime provider. Jitsi remains available as a
 * failover adapter so the backend can keep joining calls when OpenVidu is down.
 */

import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import type { IVideoProvider } from '@core/types/video.types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { OpenViduVideoProvider } from '@services/video/providers/openvidu-video.provider';
import { JitsiVideoProvider } from '@services/video/providers/jitsi-video.provider';

/**
 * Video provider factory
 */
@Injectable()
export class VideoProviderFactory {
  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => OpenViduVideoProvider))
    private readonly openviduProvider: OpenViduVideoProvider,
    @Inject(forwardRef(() => JitsiVideoProvider))
    private readonly jitsiProvider: JitsiVideoProvider,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Get the configured video provider.
   * The current runtime supports OpenVidu with Jitsi failover.
   */
  getProvider(): IVideoProvider {
    if (!this.configService.isVideoEnabled()) {
      throw new Error(
        'Video service is not enabled. Please enable VIDEO_ENABLED in configuration.'
      );
    }

    const providerType = (this.configService.getVideoProvider() ?? 'openvidu').toLowerCase();
    if (providerType === 'jitsi') {
      if (this.jitsiProvider && this.jitsiProvider.isEnabled()) {
        return this.jitsiProvider;
      }
      throw new Error('Jitsi provider is not enabled. Check JITSI_ENABLED configuration.');
    }

    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }

    throw new Error(
      'OpenVidu provider is not enabled or not initialized. Check OPENVIDU_ENABLED configuration.'
    );
  }

  /**
   * Get primary provider.
   */
  getPrimaryProvider(): IVideoProvider {
    return this.getProvider();
  }

  /**
   * Get fallback provider.
   * When OpenVidu is primary, Jitsi is fallback and vice versa.
   */
  getFallbackProvider(): IVideoProvider {
    const providerType = (this.configService.getVideoProvider() ?? 'openvidu').toLowerCase();
    if (providerType === 'openvidu') {
      if (this.jitsiProvider && this.jitsiProvider.isEnabled()) {
        return this.jitsiProvider;
      }
      throw new Error('Jitsi fallback provider is not enabled.');
    }
    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }
    throw new Error('OpenVidu fallback provider is not enabled.');
  }

  /**
   * Get provider with health check and automatic failover.
   */
  async getProviderWithFallback(): Promise<IVideoProvider> {
    const preferredOrder = (() => {
      const providerType = (this.configService.getVideoProvider() ?? 'openvidu').toLowerCase();
      if (providerType === 'jitsi') {
        return [this.jitsiProvider, this.openviduProvider];
      }
      return [this.openviduProvider, this.jitsiProvider];
    })().filter(provider => Boolean(provider && provider.isEnabled())) as IVideoProvider[];

    if (preferredOrder.length === 0) {
      throw new Error(
        'No enabled video providers are available. Check OPENVIDU_ENABLED and JITSI_ENABLED configuration.'
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
