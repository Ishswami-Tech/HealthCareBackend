import { Injectable, Optional } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';

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
  readonly platform: 'ios' | 'android' | 'web';
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
 * ARCHITECTURE:
 * - Uses in-memory Map for fast token lookups (primary storage)
 * - Optional DatabaseService integration for persistence (if provided)
 * - Follows the same patterns as database infrastructure services
 * - All operations use LoggingService for HIPAA-compliant logging
 *
 * @class DeviceTokenService
 */
@Injectable()
export class DeviceTokenService {
  private readonly tokenStore = new Map<string, DeviceTokenData>();

  constructor(
    private readonly loggingService: LoggingService,
    @Optional() private readonly databaseService?: DatabaseService
  ) {}

  /**
   * Registers a new device token
   * Uses in-memory storage for fast access, with optional database persistence
   * @param tokenData - Device token data to register
   * @returns True if registration was successful
   */
  registerDeviceToken(tokenData: DeviceTokenData): Promise<boolean> {
    try {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Registering device token',
        'DeviceTokenService',
        {
          userId: tokenData.userId,
          platform: tokenData.platform,
          tokenPrefix: this.maskToken(tokenData.token),
        }
      );

      const tokenDataWithTimestamp = {
        ...tokenData,
        lastUsed: new Date(),
      };

      // Store in memory (primary storage for fast lookups)
      this.tokenStore.set(tokenData.token, tokenDataWithTimestamp);

      // Optional: Persist to database if DatabaseService is available
      // This allows device tokens to survive service restarts
      if (this.databaseService) {
        try {
          // TODO: Add device token persistence when DeviceToken model is available
          // await this.databaseService.executeHealthcareWrite(async (client) => {
          //   await client.deviceToken.upsert({
          //     where: { token: tokenData.token },
          //     update: { ...tokenDataWithTimestamp },
          //     create: { ...tokenDataWithTimestamp }
          //   });
          // }, { userId: 'system', userRole: 'system', clinicId: '', operation: 'REGISTER_DEVICE_TOKEN', ... });
        } catch (dbError) {
          // Log but don't fail - in-memory storage is primary
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Failed to persist device token to database, using in-memory only',
            'DeviceTokenService',
            {
              error: dbError instanceof Error ? dbError.message : 'Unknown error',
              userId: tokenData.userId,
            }
          );
        }
      }

      return Promise.resolve(true);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to register device token',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId: tokenData.userId,
        }
      );
      return Promise.resolve(false);
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
    updates?: Partial<DeviceTokenData>
  ): Promise<boolean> {
    try {
      const existingData = this.tokenStore.get(oldToken);
      if (!existingData) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Old device token not found for update',
          'DeviceTokenService',
          {
            oldToken: this.maskToken(oldToken),
          }
        );
        return Promise.resolve(false);
      }

      const updatedData: DeviceTokenData = {
        ...existingData,
        ...updates,
        token: newToken,
        lastUsed: new Date(),
      };

      this.tokenStore.delete(oldToken);
      this.tokenStore.set(newToken, updatedData);

      // Optional: Update in database if DatabaseService is available
      if (this.databaseService) {
        try {
          // TODO: Add device token update when DeviceToken model is available
          // await this.databaseService.executeHealthcareWrite(async (client) => {
          //   await client.deviceToken.updateMany({
          //     where: { token: oldToken },
          //     data: { ...updatedData }
          //   });
          // }, { userId: 'system', userRole: 'system', clinicId: '', operation: 'UPDATE_DEVICE_TOKEN', ... });
        } catch (dbError) {
          // Log but don't fail - in-memory storage is primary
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Failed to update device token in database',
            'DeviceTokenService',
            {
              error: dbError instanceof Error ? dbError.message : 'Unknown error',
              userId: existingData.userId,
            }
          );
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Device token updated successfully',
        'DeviceTokenService',
        {
          userId: existingData.userId,
          oldToken: this.maskToken(oldToken),
          newToken: this.maskToken(newToken),
        }
      );

      return Promise.resolve(true);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to update device token',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          oldToken: this.maskToken(oldToken),
          newToken: this.maskToken(newToken),
        }
      );
      return Promise.resolve(false);
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
          error: 'Token not found',
        };
      }

      if (!tokenData.isActive) {
        return {
          isValid: false,
          error: 'Token is inactive',
        };
      }

      // Check if token hasn't been used for more than 90 days
      const daysSinceLastUse = tokenData.lastUsed
        ? (Date.now() - tokenData.lastUsed.getTime()) / (1000 * 60 * 60 * 24)
        : 0;

      if (daysSinceLastUse > 90) {
        return {
          isValid: false,
          error: 'Token expired due to inactivity',
          shouldUpdate: true,
        };
      }

      // Update last used timestamp
      tokenData.lastUsed = new Date();
      this.tokenStore.set(token, tokenData);

      return { isValid: true };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Token validation failed',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          token: this.maskToken(token),
        }
      );

      return {
        isValid: false,
        error: 'Validation error',
      };
    }
  }

  /**
   * Deactivates a device token
   * @param token - Device token to deactivate
   * @returns True if deactivation was successful
   */
  deactivateDeviceToken(token: string): Promise<boolean> {
    try {
      const tokenData = this.tokenStore.get(token);

      if (!tokenData) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Token not found for deactivation',
          'DeviceTokenService',
          {
            token: this.maskToken(token),
          }
        );
        return Promise.resolve(false);
      }

      tokenData.isActive = false;
      this.tokenStore.set(token, tokenData);

      // Optional: Update in database if DatabaseService is available
      if (this.databaseService) {
        try {
          // TODO: Add device token deactivation when DeviceToken model is available
          // await this.databaseService.executeHealthcareWrite(async (client) => {
          //   await client.deviceToken.updateMany({
          //     where: { token },
          //     data: { isActive: false }
          //   });
          // }, { userId: 'system', userRole: 'system', clinicId: '', operation: 'DEACTIVATE_DEVICE_TOKEN', ... });
        } catch (dbError) {
          // Log but don't fail - in-memory storage is primary
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Failed to deactivate device token in database',
            'DeviceTokenService',
            {
              error: dbError instanceof Error ? dbError.message : 'Unknown error',
              userId: tokenData.userId,
            }
          );
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Device token deactivated',
        'DeviceTokenService',
        {
          userId: tokenData.userId,
          token: this.maskToken(token),
        }
      );

      return Promise.resolve(true);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to deactivate device token',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          token: this.maskToken(token),
        }
      );
      return Promise.resolve(false);
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
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to get user tokens',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        }
      );
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

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Token cleanup completed',
        'DeviceTokenService',
        {
          cleanedCount,
          remainingCount: this.tokenStore.size,
        }
      );

      return cleanedCount;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Token cleanup failed',
        'DeviceTokenService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
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
        stats.byPlatform[tokenData.platform] = (stats.byPlatform[tokenData.platform] || 0) + 1;
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
    if (!token || token.length < 10) return 'INVALID_TOKEN';
    return `${token.substring(0, 8)}...${token.substring(token.length - 4)}`;
  }
}
