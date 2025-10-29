import { Injectable, Logger } from "@nestjs/common";

/**
 * Device token data interface
 * @interface DeviceTokenData
 */
export interface DeviceTokenData {
  /** User ID associated with the device token */
  readonly userId: string;
  /** Device token string */
  readonly token: string;
  /** Device platform */
  readonly platform: "ios" | "android" | "web";
  /** Optional app version */
  readonly appVersion?: string;
  /** Optional device model */
  readonly deviceModel?: string;
  /** Optional operating system version */
  readonly osVersion?: string;
  /** Whether the token is active */
  isActive: boolean;
  /** Last time the token was used */
  lastUsed?: Date;
}

/**
 * Token validation result interface
 * @interface TokenValidationResult
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  readonly isValid: boolean;
  /** Error message if validation failed */
  readonly error?: string;
  /** Whether the token should be updated */
  readonly shouldUpdate?: boolean;
}

/**
 * Device token management service
 * Handles registration, validation, and cleanup of device tokens
 *
 * @class DeviceTokenService
 */
@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);
  private readonly tokenStore = new Map<string, DeviceTokenData>();

  /**
   * Registers a new device token
   * @param tokenData - Device token data to register
   * @returns True if registration was successful
   */
  registerDeviceToken(tokenData: DeviceTokenData): boolean {
    try {
      this.logger.log("Registering device token", {
        userId: tokenData.userId,
        platform: tokenData.platform,
        tokenPrefix: this.maskToken(tokenData.token),
      });

      this.tokenStore.set(tokenData.token, {
        ...tokenData,
        lastUsed: new Date(),
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to register device token", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: tokenData.userId,
      });
      return false;
    }
  }

  /**
   * Updates an existing device token
   * @param oldToken - Current device token
   * @param newToken - New device token
   * @param updates - Optional additional updates to token data
   * @returns True if update was successful
   */
  updateDeviceToken(
    oldToken: string,
    newToken: string,
    updates?: Partial<DeviceTokenData>,
  ): boolean {
    try {
      const existingData = this.tokenStore.get(oldToken);
      if (!existingData) {
        this.logger.warn("Old device token not found for update", {
          oldToken: this.maskToken(oldToken),
        });
        return false;
      }

      const updatedData: DeviceTokenData = {
        ...existingData,
        ...updates,
        token: newToken,
        lastUsed: new Date(),
      };

      this.tokenStore.delete(oldToken);
      this.tokenStore.set(newToken, updatedData);

      this.logger.log("Device token updated successfully", {
        userId: existingData.userId,
        oldToken: this.maskToken(oldToken),
        newToken: this.maskToken(newToken),
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to update device token", {
        error: error instanceof Error ? error.message : "Unknown error",
        oldToken: this.maskToken(oldToken),
        newToken: this.maskToken(newToken),
      });
      return false;
    }
  }

  /**
   * Validates a device token
   * @param token - Device token to validate
   * @returns Validation result with status and error information
   */
  validateDeviceToken(token: string): TokenValidationResult {
    try {
      const tokenData = this.tokenStore.get(token);

      if (!tokenData) {
        return {
          isValid: false,
          error: "Token not found",
        };
      }

      if (!tokenData.isActive) {
        return {
          isValid: false,
          error: "Token is inactive",
        };
      }

      // Check if token hasn't been used for more than 90 days
      const daysSinceLastUse = tokenData.lastUsed
        ? (Date.now() - tokenData.lastUsed.getTime()) / (1000 * 60 * 60 * 24)
        : 0;

      if (daysSinceLastUse > 90) {
        return {
          isValid: false,
          error: "Token expired due to inactivity",
          shouldUpdate: true,
        };
      }

      // Update last used timestamp
      tokenData.lastUsed = new Date();
      this.tokenStore.set(token, tokenData);

      return { isValid: true };
    } catch (error) {
      this.logger.error("Token validation failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        token: this.maskToken(token),
      });

      return {
        isValid: false,
        error: "Validation error",
      };
    }
  }

  /**
   * Deactivates a device token
   * @param token - Device token to deactivate
   * @returns True if deactivation was successful
   */
  deactivateDeviceToken(token: string): boolean {
    try {
      const tokenData = this.tokenStore.get(token);

      if (!tokenData) {
        this.logger.warn("Token not found for deactivation", {
          token: this.maskToken(token),
        });
        return false;
      }

      tokenData.isActive = false;
      this.tokenStore.set(token, tokenData);

      this.logger.log("Device token deactivated", {
        userId: tokenData.userId,
        token: this.maskToken(token),
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to deactivate device token", {
        error: error instanceof Error ? error.message : "Unknown error",
        token: this.maskToken(token),
      });
      return false;
    }
  }

  /**
   * Gets all active tokens for a user
   * @param userId - User ID to get tokens for
   * @returns Array of active device tokens for the user
   */
  getUserTokens(userId: string): DeviceTokenData[] {
    try {
      const userTokens: DeviceTokenData[] = [];

      for (const tokenData of Array.from(this.tokenStore.values())) {
        if (tokenData.userId === userId && tokenData.isActive) {
          userTokens.push(tokenData);
        }
      }

      return userTokens;
    } catch (error) {
      this.logger.error("Failed to get user tokens", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId,
      });
      return [];
    }
  }

  /**
   * Cleans up inactive and expired tokens
   * @returns Number of tokens that were cleaned up
   */
  cleanupInactiveTokens(): number {
    try {
      let cleanedCount = 0;
      const now = Date.now();
      const inactivityThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

      for (const [token, tokenData] of Array.from(this.tokenStore.entries())) {
        const lastUsed = tokenData.lastUsed?.getTime() || 0;
        const isInactive = now - lastUsed > inactivityThreshold;

        if (!tokenData.isActive || isInactive) {
          this.tokenStore.delete(token);
          cleanedCount++;
        }
      }

      this.logger.log("Token cleanup completed", {
        cleanedCount,
        remainingCount: this.tokenStore.size,
      });

      return cleanedCount;
    } catch (error) {
      this.logger.error("Token cleanup failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return 0;
    }
  }

  /**
   * Gets token statistics
   * @returns Object containing token statistics by platform and status
   */
  getTokenStats(): {
    readonly total: number;
    readonly active: number;
    readonly inactive: number;
    readonly byPlatform: Record<string, number>;
  } {
    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      byPlatform: {} as Record<string, number>,
    };

    for (const tokenData of Array.from(this.tokenStore.values())) {
      stats.total++;

      if (tokenData.isActive) {
        stats.active++;
      } else {
        stats.inactive++;
      }

      if (tokenData.platform) {
        stats.byPlatform[tokenData.platform] =
          (stats.byPlatform[tokenData.platform] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Masks device token for logging (privacy)
   * @param token - Device token to mask
   * @returns Masked token string
   * @private
   */
  private maskToken(token: string): string {
    if (!token || token.length < 10) return "INVALID_TOKEN";
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }
}
