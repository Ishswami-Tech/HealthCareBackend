/**
 * Video Provider Factory
 * @class VideoProviderFactory
 * @description Factory for creating video providers based on configuration
 * Supports multiple providers: OpenVidu (primary), Jitsi (fallback)
 * Similar to CacheProviderFactory pattern
 */

import { Injectable, Inject, forwardRef, Optional } from '@nestjs/common';
import { ConfigService } from '@config';
import type { IVideoProvider } from '@core/types/video.types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { OpenViduVideoProvider } from './openvidu-video.provider';
import { JitsiVideoProvider } from './jitsi-video.provider';

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
   * Returns OpenVidu as primary, Jitsi as fallback
   * Similar to CacheProviderFactory.getProvider() pattern
   */
  getProvider(): IVideoProvider {
    // Check if video is enabled using ConfigService
    if (!this.configService.isVideoEnabled()) {
      // Return Jitsi as fallback even if disabled (graceful degradation)
      return this.jitsiProvider;
    }

    const providerType = this.configService.getVideoProvider();

    // Defensive check: ensure providers are initialized
    switch (providerType) {
      case 'openvidu':
        // Primary: OpenVidu (similar to Dragonfly in cache pattern)
        if (this.openviduProvider && this.openviduProvider.isEnabled()) {
          return this.openviduProvider;
        }
        // Fallback to Jitsi if OpenVidu is not available
        return this.jitsiProvider;
      case 'jitsi':
      default:
        // Fallback: Jitsi (similar to Redis in cache pattern)
        if (this.jitsiProvider && this.jitsiProvider.isEnabled()) {
          return this.jitsiProvider;
        }
        // Last resort: return Jitsi even if not fully configured
        return this.jitsiProvider;
    }
  }

  /**
   * Get primary provider (OpenVidu)
   */
  getPrimaryProvider(): IVideoProvider {
    if (this.openviduProvider && this.openviduProvider.isEnabled()) {
      return this.openviduProvider;
    }
    // Fallback to Jitsi if OpenVidu not available
    return this.jitsiProvider;
  }

  /**
   * Get fallback provider (Jitsi)
   */
  getFallbackProvider(): IVideoProvider {
    return this.jitsiProvider;
  }

  /**
   * Get provider with health check and automatic fallback
   */
  async getProviderWithFallback(): Promise<IVideoProvider> {
    const primary = this.getPrimaryProvider();

    // Check health of primary provider
    if (primary.providerName === 'openvidu') {
      const isHealthy = await primary.isHealthy();
      if (isHealthy) {
        return primary;
      }
      // Fallback to Jitsi if OpenVidu is unhealthy
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'OpenVidu provider unhealthy, falling back to Jitsi',
          'VideoProviderFactory.getProviderWithFallback',
          {}
        );
      }
      return this.getFallbackProvider();
    }

    return primary;
  }
}
