/**
 * Video Provider Factory
 * @class VideoProviderFactory
 * @description Factory for creating video providers based on configuration
 * Supports multiple providers: OpenVidu (primary), Jitsi (fallback)
 * Similar to CacheProviderFactory pattern
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
   * Get the configured video provider
   * Returns OpenVidu ONLY (no Jitsi fallback)
   * Similar to CacheProviderFactory.getProvider() pattern
   */
  getProvider(): IVideoProvider {
    // Only use OpenVidu - no fallback to Jitsi
    if (!this.configService.isVideoEnabled()) {
      throw new Error(
        'Video service is not enabled. Please enable VIDEO_ENABLED in configuration.'
      );
    }

    const providerType = this.configService.getVideoProvider();

    // Only accept OpenVidu as provider
    if (providerType !== 'openvidu') {
      throw new Error(`Invalid video provider: ${providerType}. Only 'openvidu' is supported.`);
    }

    // Return OpenVidu provider
    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }

    throw new Error(
      'OpenVidu provider is not enabled or not initialized. Check OPENVIDU_ENABLED configuration.'
    );
  }

  /**
   * Get primary provider (OpenVidu ONLY)
   */
  getPrimaryProvider(): IVideoProvider {
    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }
    throw new Error('OpenVidu provider is not enabled or not initialized.');
  }

  /**
   * Get fallback provider (DEPRECATED - OpenVidu only)
   * @deprecated This method is deprecated. Only OpenVidu is supported.
   */
  getFallbackProvider(): IVideoProvider {
    throw new Error('Fallback provider (Jitsi) is not supported. Only OpenVidu is configured.');
  }

  /**
   * Get provider with health check (OpenVidu ONLY - no fallback)
   * NOTE: This method now logs warnings instead of throwing errors
   * to prevent crashing the entire API when video services are unavailable.
   * Video features will be disabled but core healthcare features will work.
   */
  async getProviderWithFallback(): Promise<IVideoProvider> {
    const primary = this.getPrimaryProvider();

    // Check health of OpenVidu provider
    if (primary.providerName === 'openvidu') {
      try {
        const isHealthy = await primary.isHealthy();
        if (!isHealthy) {
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.WARN,
              'OpenVidu provider is unhealthy. Video features will be unavailable. API will continue without video support.',
              'VideoProviderFactory.getProviderWithFallback',
              { provider: 'openvidu', healthStatus: 'unhealthy' }
            );
          }
          // Return provider anyway - methods will fail gracefully when called
          // This allows the API to start even if OpenVidu is temporarily unavailable
        }
      } catch (error) {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `OpenVidu health check failed: ${error instanceof Error ? error.message : 'Unknown error'}. Video features will be unavailable.`,
            'VideoProviderFactory.getProviderWithFallback',
            { provider: 'openvidu', error: error instanceof Error ? error.message : 'Unknown' }
          );
        }
        // Return provider anyway - graceful degradation
      }
      return primary;
    }

    return primary;
  }
}
