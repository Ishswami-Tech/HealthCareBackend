/**
 * ABDM Gateway Client
 * ====================
 * Thin client for India's Ayushman Bharat Digital Mission (ABDM) gateway.
 *
 * Phase 1 scaffolding only: nothing in the codebase calls this client yet.
 * `getAccessToken()` exchanges the Bridge credentials for a session token via
 * `POST {gatewayBaseUrl}/v0.5/sessions` and caches it (via the shared
 * `CacheService`, Dragonfly-backed) until shortly before it expires.
 *
 * @module AbdmGatewayClient
 */

import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types/logging.types';
import { AbdmConfigService } from '@config/abdm-config.service';

/** `POST /v0.5/sessions` request body per the ABDM gateway Bridge auth spec. */
interface AbdmSessionRequest {
  clientId: string;
  clientSecret: string;
  grantType: 'client_credentials';
}

/** `POST /v0.5/sessions` response body (only the fields this client reads). */
interface AbdmSessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  refreshToken?: string;
  tokenType?: string;
}

/** Refresh this many seconds before the token's real expiry, so a call never races it. */
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;
const ACCESS_TOKEN_CACHE_KEY = 'abdm:bridge:access-token';

@Injectable()
export class AbdmGatewayClient {
  constructor(
    @Inject(forwardRef(() => AbdmConfigService))
    private readonly abdmConfig: AbdmConfigService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /** A cached Bridge access token, fetching a fresh one shortly before it expires. */
  async getAccessToken(): Promise<string> {
    const cached = await this.cacheService.get<string>(ACCESS_TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const response = await this.httpService.post<AbdmSessionResponse, AbdmSessionRequest>(
      `${this.abdmConfig.gatewayBaseUrl}/v0.5/sessions`,
      {
        clientId: this.abdmConfig.bridgeClientId,
        clientSecret: this.abdmConfig.bridgeClientSecret,
        grantType: 'client_credentials',
      }
    );

    const { accessToken, expiresIn } = response.data;
    const ttlSeconds = Math.max(1, expiresIn - TOKEN_EXPIRY_BUFFER_SECONDS);
    await this.cacheService.set(ACCESS_TOKEN_CACHE_KEY, accessToken, ttlSeconds);

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Fetched a new ABDM bridge access token',
      'AbdmGatewayClient',
      { expiresIn }
    );

    return accessToken;
  }
}
