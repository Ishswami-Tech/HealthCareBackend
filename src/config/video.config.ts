/**
 * Video Configuration - Single Source of Truth
 * @file video.config.ts
 * @description Centralized video configuration that determines video provider
 * This is the ONLY place where VIDEO_PROVIDER should be checked
 * All video services must use this configuration
 *
 * Supports multiple providers: Cloudflare Realtime, Daily, Google Meet
 * Similar to cache.config.ts pattern (Redis/Dragonfly)
 */

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
 * Check if video no-show enforcement is enabled.
 * When disabled, the scheduler and join gates keep video appointments testable.
 */
export function isVideoNoShowEnabled(): boolean {
  return getEnvBoolean('VIDEO_NO_SHOW_ENABLED', false);
}

/**
 * Video appointment payment window in minutes.
 *
 * When a patient books a VIDEO_CALL appointment, they have this many minutes
 * to complete the payment. If the timer expires without a successful payment,
 * the appointment is auto-cancelled by the scheduler.
 *
 * - VIDEO_CALL appointments require upfront payment (per-appointment pricing).
 * - IN_PERSON appointments use the clinic's subscription model and are not
 *   affected by this window.
 *
 * Defaults to 15 minutes.
 */
export function getVideoPaymentWindowMinutes(): number {
  const raw = getEnv('VIDEO_PAYMENT_WINDOW_MINUTES');
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(Math.floor(parsed), 1), 60);
  }
  return 15;
}

/**
 * Video appointment active/join window in minutes.
 *
 * The join window stays open this long after the scheduled start time.
 * The scheduler uses the same source of truth to expire confirmed video
 * appointments that never started.
 *
 * Defaults to 300 minutes.
 */
export function getVideoActiveWindowMinutes(): number {
  const raw = getEnv('VIDEO_ACTIVE_WINDOW_MINUTES');
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(Math.floor(parsed), 1), 720);
  }
  return 300;
}

/**
 * Get video provider type
 * @returns 'cloudflare' | 'daily' | 'google-meet'
 */
export function getVideoProvider(): 'cloudflare' | 'daily' | 'google-meet' {
  if (!isVideoEnabled()) {
    return 'cloudflare'; // Default fallback
  }

  const provider = getEnvWithDefault('VIDEO_PROVIDER', 'cloudflare').toLowerCase();
  if (provider === 'cloudflare' || provider === 'daily' || provider === 'google-meet') {
    return provider;
  }

  return 'cloudflare'; // Default to Cloudflare Realtime (primary)
}

/**
 * Video configuration factory
 * This is registered with NestJS ConfigModule as 'video'
 */
export const videoConfig = (): VideoProviderConfig => {
  const enabled = isVideoEnabled();
  const noShowEnabled = isVideoNoShowEnabled();
  const provider = getVideoProvider();

  const cloudflareConfig: VideoProviderConfig['cloudflare'] = {
    accountId: getEnv('CLOUDFLARE_ACCOUNT_ID') || '',
    appId: getEnv('CLOUDFLARE_APP_ID') || '',
    apiToken: getEnv('CLOUDFLARE_API_TOKEN') || '',
    apiBaseUrl: getEnvWithDefault(
      'CLOUDFLARE_API_BASE_URL',
      'https://api.cloudflare.com/client/v4'
    ),
    enabled:
      enabled &&
      Boolean(getEnv('CLOUDFLARE_ACCOUNT_ID')) &&
      Boolean(getEnv('CLOUDFLARE_APP_ID')) &&
      Boolean(getEnv('CLOUDFLARE_API_TOKEN')),
    webhookEnabled: getEnvBoolean('CLOUDFLARE_WEBHOOK_ENABLED', false),
    hostPresetName: getEnvWithDefault('CLOUDFLARE_HOST_PRESET_NAME', 'group-call-host'),
    participantPresetName: getEnvWithDefault(
      'CLOUDFLARE_PARTICIPANT_PRESET_NAME',
      'group-call-participant'
    ),
  };

  const dailyConfig: VideoProviderConfig['daily'] = {
    apiBaseUrl: getEnvWithDefault('DAILY_API_BASE_URL', 'https://api.daily.co/v1'),
    apiKey: getEnv('DAILY_API_KEY') || '',
    domain: getEnv('DAILY_DOMAIN') || '',
    enabled: enabled && Boolean(getEnv('DAILY_API_KEY')) && Boolean(getEnv('DAILY_DOMAIN')),
    webhookEnabled: getEnvBoolean('DAILY_WEBHOOK_ENABLED', false),
    statusUrl: getEnvWithDefault('DAILY_STATUS_URL', 'https://status.daily.co/'),
    privacy: getEnvWithDefault('DAILY_PRIVACY', 'public') === 'private' ? 'private' : 'public',
    roomDurationMinutes: Math.max(
      15,
      parseInt(getEnvWithDefault('DAILY_ROOM_DURATION_MINUTES', '120'), 10) || 120
    ),
  };

  const googleMeetConfig: VideoProviderConfig['googleMeet'] = {
    enabled:
      enabled &&
      getEnvBoolean('GOOGLE_MEET_ENABLED', true) &&
      Boolean(getEnv('GOOGLE_CLIENT_ID')) &&
      Boolean(getEnv('GOOGLE_CLIENT_SECRET')) &&
      Boolean(getEnv('GOOGLE_MEET_REFRESH_TOKEN')),
    apiBaseUrl: getEnvWithDefault('GOOGLE_MEET_API_BASE_URL', 'https://meet.googleapis.com/v2'),
    clientId: getEnv('GOOGLE_CLIENT_ID') || '',
    clientSecret: getEnv('GOOGLE_CLIENT_SECRET') || '',
    redirectUri: getEnv('GOOGLE_REDIRECT_URI') || '',
    refreshToken: getEnv('GOOGLE_MEET_REFRESH_TOKEN') || '',
    oauthScope: getEnvWithDefault(
      'GOOGLE_MEET_OAUTH_SCOPE',
      'https://www.googleapis.com/auth/meetings.space.created'
    ),
  };

  return {
    enabled,
    noShowEnabled,
    provider,
    cloudflare: cloudflareConfig,
    daily: dailyConfig,
    googleMeet: googleMeetConfig,
  };
};

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
