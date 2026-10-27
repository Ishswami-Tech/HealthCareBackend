/**
 * ABDM Config Service
 * ====================
 * Reads the Bridge credentials and gateway/callback URLs for India's Ayushman
 * Bharat Digital Mission (ABDM) integration from the environment, the same way
 * every other config sub-service in this directory reads env-backed settings
 * (via the enhanced `ConfigService`, never `@nestjs/config` directly).
 *
 * Phase 1 scaffolding only: nothing in this phase calls the ABDM gateway, so
 * this service has no fallback/default-credential logic yet — a missing env
 * var simply resolves to an empty string until the gateway client is wired up.
 *
 * @module AbdmConfigService
 */

import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { ConfigService } from './config.service';

@Injectable()
export class AbdmConfigService {
  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService
  ) {}

  /** ABDM Bridge client id issued by the ABDM gateway for this facility bridge. */
  get bridgeClientId(): string {
    return this.configService.getEnv('ABDM_BRIDGE_CLIENT_ID', '') ?? '';
  }

  /** ABDM Bridge client secret issued by the ABDM gateway for this facility bridge. */
  get bridgeClientSecret(): string {
    return this.configService.getEnv('ABDM_BRIDGE_CLIENT_SECRET', '') ?? '';
  }

  /** Base URL of the ABDM gateway (sandbox or production), no trailing slash. */
  get gatewayBaseUrl(): string {
    return this.configService.getEnv('ABDM_GATEWAY_BASE_URL', '') ?? '';
  }

  /** Base URL ABDM calls back into for this facility bridge's callback endpoints. */
  get callbackBaseUrl(): string {
    return this.configService.getEnv('ABDM_CALLBACK_BASE_URL', '') ?? '';
  }
}
