import type { JitsiConfig } from '@core/types';
import { getEnv, getEnvWithDefault, getEnvBoolean } from './environment/utils';

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
  // All values must come from environment variables - no hardcoded defaults
  const fullDomain = getEnv('JITSI_DOMAIN') || '';

  // Calculate baseDomain from environment variable
  const baseDomainEnv = getEnv('JITSI_BASE_DOMAIN');
  let baseDomain: string = '';
  if (baseDomainEnv) {
    baseDomain = baseDomainEnv;
  } else if (fullDomain && !fullDomain.includes(':')) {
    // Extract base domain from full domain if JITSI_BASE_DOMAIN not set
    const parts = fullDomain.split('.');
    baseDomain = parts.length >= 2 ? parts.slice(-2).join('.') : fullDomain;
  }

  // Calculate subdomain from environment variable
  const subdomainEnv = getEnv('JITSI_SUBDOMAIN');
  let subdomain: string = '';
  if (subdomainEnv) {
    subdomain = subdomainEnv;
  } else if (fullDomain && !fullDomain.includes(':')) {
    // Extract subdomain from full domain if JITSI_SUBDOMAIN not set
    const parts = fullDomain.split('.');
    const firstPart = parts[0];
    if (firstPart && firstPart.length > 0) {
      subdomain = firstPart;
    }
  }

  // Get URLs from environment variables - no hardcoded defaults
  const baseUrlEnv = getEnv('JITSI_BASE_URL');
  const baseUrl = baseUrlEnv || (fullDomain ? `https://${fullDomain}` : '');

  const wsUrlEnv = getEnv('JITSI_WS_URL');
  const wsUrl = wsUrlEnv || (fullDomain ? `wss://${fullDomain}/xmpp-websocket` : '');

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
