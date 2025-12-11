/**
 * Video Configuration - Single Source of Truth
 * @file video.config.ts
 * @description Centralized video configuration that determines video provider
 * This is the ONLY place where VIDEO_PROVIDER should be checked
 * All video services must use this configuration
 *
 * Supports multiple providers: OpenVidu (primary), Jitsi (fallback)
 * Similar to cache.config.ts pattern (Redis/Dragonfly)
 */

import { registerAs } from '@nestjs/config';
import type { VideoProviderConfig } from '@core/types/video.types';
import { getEnv, getEnvWithDefault, getEnvBoolean } from './environment/utils';

/**
 * Check if video is enabled
 * @returns true if video is enabled, false otherwise
 */
export function isVideoEnabled(): boolean {
  return getEnvBoolean('VIDEO_ENABLED', true);
}

/**
 * Get video provider type
 * @returns 'openvidu' | 'jitsi'
 */
export function getVideoProvider(): 'openvidu' | 'jitsi' {
  if (!isVideoEnabled()) {
    return 'jitsi'; // Default fallback
  }

  const provider = getEnvWithDefault('VIDEO_PROVIDER', 'openvidu').toLowerCase();
  if (provider === 'openvidu' || provider === 'jitsi') {
    return provider;
  }

  return 'openvidu'; // Default to OpenVidu (primary)
}

/**
 * Video configuration factory
 * This is registered with NestJS ConfigModule as 'video'
 */
export const videoConfig = registerAs('video', (): VideoProviderConfig => {
  const enabled = isVideoEnabled();
  const provider = getVideoProvider();

  const openviduConfig: VideoProviderConfig['openvidu'] = {
    url: getEnvWithDefault('OPENVIDU_URL', 'https://video.yourdomain.com'),
    secret: getEnv('OPENVIDU_SECRET') || '',
    domain: getEnvWithDefault('OPENVIDU_DOMAIN', 'video.yourdomain.com'),
    enabled: provider === 'openvidu' && enabled,
    webhookEnabled: getEnvBoolean('OPENVIDU_WEBHOOK_ENABLED', false),
  };

  const webhookEndpoint = getEnv('OPENVIDU_WEBHOOK_ENDPOINT');
  if (webhookEndpoint !== undefined && webhookEndpoint !== null && webhookEndpoint !== '') {
    openviduConfig.webhookEndpoint = webhookEndpoint;
  }

  const webhookEvents = getEnv('OPENVIDU_WEBHOOK_EVENTS');
  if (webhookEvents !== undefined && webhookEvents !== null && webhookEvents !== '') {
    openviduConfig.webhookEvents = webhookEvents;
  }

  return {
    enabled,
    provider,
    openvidu: openviduConfig,
    // Jitsi configuration (for fallback)
    jitsi: {
      domain: getEnvWithDefault('JITSI_DOMAIN', 'localhost:8443'),
      baseUrl: getEnvWithDefault('JITSI_BASE_URL', ''),
      wsUrl: getEnvWithDefault('JITSI_WS_URL', ''),
      appId: getEnvWithDefault('JITSI_APP_ID', 'healthcare-jitsi-app'),
      appSecret: getEnv('JITSI_APP_SECRET') || '',
      enabled: true, // Always enabled as fallback (similar to Redis in cache pattern)
      enableRecording: getEnvBoolean('JITSI_ENABLE_RECORDING', true),
      enableWaitingRoom: getEnvBoolean('JITSI_ENABLE_WAITING_ROOM', true),
    },
  };
});

/**
 * Default export - video config
 */
export default videoConfig;

/**
 * Export utility functions for direct use (without ConfigService)
 * These can be used in module initialization before ConfigService is available
 */
export const VideoConfigUtils = {
  isEnabled: isVideoEnabled,
  getProvider: getVideoProvider,
};
