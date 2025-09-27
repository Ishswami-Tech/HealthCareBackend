import { Injectable, Logger } from "@nestjs/common";

export interface DeviceTokenData {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
  appVersion?: string;
  deviceModel?: string;
  osVersion?: string;
  isActive: boolean;
  lastUsed?: Date;
}

export interface TokenValidationResult {
  isValid: boolean;
  error?: string;
  shouldUpdate?: boolean;
}

@Injectable()
export class DeviceTokenService {
  private readonly logger = new Logger(DeviceTokenService.name);
  private readonly tokenStore = new Map<string, DeviceTokenData>();

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

  getUserTokens(userId: string): DeviceTokenData[] {
    try {
      const userTokens: DeviceTokenData[] = [];

      for (const tokenData of this.tokenStore.values()) {
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

  cleanupInactiveTokens(): number {
    try {
      let cleanedCount = 0;
      const now = Date.now();
      const inactivityThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days in milliseconds

      for (const [token, tokenData] of this.tokenStore.entries()) {
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

  getTokenStats(): {
    total: number;
    active: number;
    inactive: number;
    byPlatform: Record<string, number>;
  } {
    const stats = {
      total: 0,
      active: 0,
      inactive: 0,
      byPlatform: {} as Record<string, number>,
    };

    for (const tokenData of this.tokenStore.values()) {
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

  private maskToken(token: string): string {
    if (!token || token.length < 10) return "INVALID_TOKEN";
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }
}
