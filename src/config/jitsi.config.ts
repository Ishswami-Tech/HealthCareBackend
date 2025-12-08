import type { JitsiConfig } from '@core/types';
import { getEnvWithDefault, getEnvBoolean } from './environment/utils';

/**
 * Jitsi Meet Configuration Factory
 *
 * Creates Jitsi configuration from environment variables
 * Supports both local development and production deployments
 *
 * Note: Environment variables are loaded via dotenv in config.module.ts
 * This factory accesses them through process.env (which dotenv populates)
 * All services should use ConfigService.getJitsiConfig() instead of this factory directly
 *
 * @returns Jitsi configuration object
 */
export default function createJitsiConfig(): JitsiConfig {
  // Environment variables are already loaded by dotenv in config.module.ts
  // Access them via process.env (populated by dotenv)

  // Use helper functions (which use dotenv) for environment variable access
  // These mimic ConfigService methods but work in config factories
  // Dotenv is already loaded by config.module.ts before factories run
  const fullDomain = getEnvWithDefault('JITSI_DOMAIN', 'localhost:8443');

  // Calculate baseDomain with fallback
  const baseDomainEnv = getEnvWithDefault('JITSI_BASE_DOMAIN', '');
  let baseDomain: string;
  if (baseDomainEnv) {
    baseDomain = baseDomainEnv;
  } else if (fullDomain.includes(':')) {
    baseDomain = 'localhost';
  } else {
    const parts = fullDomain.split('.');
    baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : fullDomain;
  }

  // Calculate subdomain with fallback
  const subdomainEnv = getEnvWithDefault('JITSI_SUBDOMAIN', '');
  let subdomain: string = 'localhost'; // Default value
  if (subdomainEnv) {
    subdomain = subdomainEnv;
  } else if (!fullDomain.includes(':')) {
    const parts = fullDomain.split('.');
    const firstPart = parts[0];
    if (firstPart && firstPart.length > 0) {
      subdomain = firstPart;
    }
  }

  // Construct URLs if not provided
  const baseUrlEnv = getEnvWithDefault('JITSI_BASE_URL', '');
  const baseUrl =
    baseUrlEnv || (fullDomain.includes(':') ? `https://${fullDomain}` : `https://${fullDomain}`);

  const wsUrlEnv = getEnvWithDefault('JITSI_WS_URL', '');
  const wsUrl =
    wsUrlEnv ||
    (fullDomain.includes(':')
      ? `wss://${fullDomain}/xmpp-websocket`
      : `wss://${fullDomain}/xmpp-websocket`);

  const appId = getEnvWithDefault('JITSI_APP_ID', 'healthcare-jitsi-app');
  const appSecret = getEnvWithDefault('JITSI_APP_SECRET', '');

  return {
    domain: fullDomain,
    baseDomain,
    subdomain,
    appId,
    appSecret,
    baseUrl,
    wsUrl,
    enabled: getEnvBoolean('VIDEO_ENABLED', true),
    enableRecording: getEnvBoolean('JITSI_ENABLE_RECORDING', true),
    enableWaitingRoom: getEnvBoolean('JITSI_ENABLE_WAITING_ROOM', true),
  };
}
