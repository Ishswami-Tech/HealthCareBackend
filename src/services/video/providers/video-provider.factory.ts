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
   * Get the configured video provider.
   * Supports multiple providers: openvidu | jitsi
   * Provider is selected via VIDEO_PROVIDER env variable.
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

    // Default: OpenVidu
    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }

    throw new Error(
      'OpenVidu provider is not enabled or not initialized. Check OPENVIDU_ENABLED configuration.'
    );
  }

  /**
   * Get primary provider (resolves from VIDEO_PROVIDER config).
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
   * Get provider with health check (OpenVidu ONLY - no fallback)
   * NOTE: This method now logs warnings instead of throwing errors
   * to prevent crashing the entire API when video services are unavailable.
   * Video features will be disabled but core healthcare features will work.
   */
  async getProviderWithFallback(): Promise<IVideoProvider> {
    const primary = this.getPrimaryProvider();

    try {
      const isHealthy = await primary.isHealthy();
      if (isHealthy) return primary;

      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Primary video provider '${primary.providerName}' is unhealthy. Attempting fallback.`,
          'VideoProviderFactory.getProviderWithFallback',
          { provider: primary.providerName, healthStatus: 'unhealthy' }
        );
      }

      // Try fallback provider
      try {
        const fallback = this.getFallbackProvider();
        const fallbackHealthy = await fallback.isHealthy();
        if (fallbackHealthy) return fallback;
      } catch {
        // No fallback available
      }

      // Return primary anyway — let method calls fail gracefully
      return primary;
    } catch (error) {
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Video provider health check failed: ${error instanceof Error ? error.message : 'Unknown error'}. Video features may be unavailable.`,
          'VideoProviderFactory.getProviderWithFallback',
          {
            provider: primary.providerName,
            error: error instanceof Error ? error.message : 'Unknown',
          }
        );
      }
      return primary;
    }
  }
}
