import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
import * as admin from 'firebase-admin';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { SNSBackupService } from '@communication/channels/push/sns-backup.service';
import { DeviceTokenService } from '@communication/channels/push/device-token.service';

/**
 * Push notification data interface
 * @interface PushNotificationData
 */
export interface PushNotificationData {
  /** Notification title */
  readonly title: string;
  /** Notification body text */
  readonly body: string;
  /** Optional custom data payload */
  readonly data?: Record<string, string>;
}

/**
 * Push notification result interface
 * @interface PushNotificationResult
 */
export interface PushNotificationResult {
  /** Whether the operation was successful */
  readonly success: boolean;
  /** Message ID from Firebase (single device) */
  readonly messageId?: string;
  /** Number of successful deliveries (multiple devices) */
  readonly successCount?: number;
  /** Number of failed deliveries (multiple devices) */
  readonly failureCount?: number;
  /** Error message if operation failed */
  readonly error?: string;
  /** Provider used for delivery (fcm or sns) */
  readonly provider?: 'fcm' | 'sns';
  /** Whether fallback was used */
  readonly usedFallback?: boolean;
}

/**
 * Push notification service using Firebase Cloud Messaging (Primary)
 * with AWS SNS as backup provider
 *
 * Architecture:
 * - FCM (Firebase Cloud Messaging) as primary provider (free, reliable)
 * - AWS SNS as backup provider (HIPAA-compliant, high availability)
 * - Automatic fallback: If FCM fails, retry with SNS
 * - Platform detection: Automatically detects iOS/Android for SNS
 *
 * @class PushNotificationService
 * @implements {OnModuleInit}
 */
@Injectable()
export class PushNotificationService implements OnModuleInit {
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;
  private snsBackupService?: SNSBackupService;
  private deviceTokenService?: DeviceTokenService;

  /**
   * Creates an instance of PushNotificationService
   * @param configService - Configuration service for environment variables
   * @param loggingService - Logging service for HIPAA-compliant logging
   * @param snsBackupService - Optional SNS backup service (injected via forwardRef to avoid circular dependency)
   * @param deviceTokenService - Optional device token service for platform detection
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SNSBackupService))
    snsBackupService?: SNSBackupService,
    @Inject(forwardRef(() => DeviceTokenService))
    deviceTokenService?: DeviceTokenService
  ) {
    // Only assign if value is defined to satisfy exactOptionalPropertyTypes
    if (snsBackupService !== undefined) {
      this.snsBackupService = snsBackupService;
    }
    if (deviceTokenService !== undefined) {
      this.deviceTokenService = deviceTokenService;
    }
  }

  /**
   * Initializes Firebase on module startup
   */
  onModuleInit(): void {
    this.initializeFirebase();
  }

  /**
   * Initializes Firebase Admin SDK
   * @private
   */
  private initializeFirebase(): void {
    try {
      const projectId =
        this.configService?.get<string>('FIREBASE_PROJECT_ID') ||
        process.env['FIREBASE_PROJECT_ID'];
      const privateKey =
        this.configService?.get<string>('FIREBASE_PRIVATE_KEY') ||
        process.env['FIREBASE_PRIVATE_KEY'];
      const clientEmail =
        this.configService?.get<string>('FIREBASE_CLIENT_EMAIL') ||
        process.env['FIREBASE_CLIENT_EMAIL'];

      if (!projectId || !privateKey || !clientEmail) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Firebase credentials not provided, push notification service will be disabled',
          'PushNotificationService'
        );
        this.isInitialized = false;
        return;
      }

      // Initialize Firebase Admin SDK if not already initialized
      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
        });
      } else {
        this.firebaseApp = admin.app();
      }

      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Firebase push notification service initialized successfully',
        'PushNotificationService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to initialize Firebase',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      this.isInitialized = false;
    }
  }

  /**
   * Sends push notification to a single device
   * Uses FCM as primary, falls back to SNS if FCM fails
   * @param deviceToken - Firebase device token
   * @param notification - Notification data
   * @param userId - Optional user ID for platform detection
   * @returns Promise resolving to notification result
   */
  async sendToDevice(
    deviceToken: string,
    notification: PushNotificationData,
    userId?: string
  ): Promise<PushNotificationResult> {
    // Try FCM first (primary provider)
    const fcmResult = await this.sendViaFCM(deviceToken, notification);

    // If FCM succeeded, return immediately
    if (fcmResult.success) {
      return {
        ...fcmResult,
        provider: 'fcm',
        usedFallback: false,
      };
    }

    // FCM failed, try SNS backup
    void this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.WARN,
      'FCM push notification failed, attempting SNS backup',
      'PushNotificationService',
      {
        deviceToken: this.maskToken(deviceToken),
        title: notification.title,
        fcmError: fcmResult.error,
        userId,
      }
    );

    const snsResult = await this.sendViaSNS(deviceToken, notification, userId);

    if (snsResult.success) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Push notification sent successfully via SNS backup',
        'PushNotificationService',
        {
          deviceToken: this.maskToken(deviceToken),
          title: notification.title,
          messageId: snsResult.messageId,
          userId,
        }
      );
    } else {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Both FCM and SNS failed to send push notification',
        'PushNotificationService',
        {
          deviceToken: this.maskToken(deviceToken),
          title: notification.title,
          fcmError: fcmResult.error,
          snsError: snsResult.error,
          userId,
        }
      );
    }

    return {
      ...snsResult,
      provider: 'sns',
      usedFallback: true,
    };
  }

  /**
   * Sends push notification via FCM (primary provider)
   * @private
   */
  private async sendViaFCM(
    deviceToken: string,
    notification: PushNotificationData
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      return { success: false, error: 'FCM service not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        token: deviceToken,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data || {},
        android: {
          notification: {
            channelId: 'healthcare_notifications',
            priority: 'high' as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      };

      const response = await admin.messaging().send(message);

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Push notification sent successfully via FCM',
        'PushNotificationService',
        {
          messageId: response,
          deviceToken: this.maskToken(deviceToken),
          title: notification.title,
        }
      );

      return { success: true, messageId: response };
    } catch (error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send push notification via FCM',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          deviceToken: this.maskToken(deviceToken),
          title: notification.title,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sends push notification via SNS (backup provider)
   * Automatically detects platform (iOS/Android) from device token service
   * @private
   */
  private async sendViaSNS(
    deviceToken: string,
    notification: PushNotificationData,
    userId?: string
  ): Promise<PushNotificationResult> {
    // Check if SNS backup service is available
    if (!this.snsBackupService || !this.snsBackupService.isHealthy()) {
      return {
        success: false,
        error: 'SNS backup service not available',
      };
    }

    // Detect platform from device token service if available
    let platform: 'ios' | 'android' = 'android'; // Default to Android

    if (this.deviceTokenService && userId) {
      const userTokens = this.deviceTokenService.getUserTokens(userId);
      const tokenData = userTokens.find(token => token.token === deviceToken);
      if (tokenData) {
        platform = tokenData.platform === 'ios' ? 'ios' : 'android';
      }
    }

    // If platform still not detected, try heuristic (iOS tokens are typically longer)
    // This is a fallback - proper detection should come from DeviceTokenService
    if (platform === 'android' && deviceToken.length > 100) {
      platform = 'ios';
    }

    try {
      const result = await this.snsBackupService.sendPushNotification(
        deviceToken,
        notification,
        platform
      );

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sends push notification to multiple devices
   * @param deviceTokens - Array of Firebase device tokens
   * @param notification - Notification data
   * @returns Promise resolving to notification result
   */
  async sendToMultipleDevices(
    deviceTokens: string[],
    notification: PushNotificationData
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Push notification service is not initialized, skipping notification',
        'PushNotificationService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const message: admin.messaging.MulticastMessage = {
        tokens: deviceTokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data || {},
        android: {
          notification: {
            channelId: 'healthcare_notifications',
            priority: 'high' as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Push notifications sent to multiple devices',
        'PushNotificationService',
        {
          successCount: response.successCount,
          failureCount: response.failureCount,
          totalTokens: deviceTokens.length,
          title: notification.title,
        }
      );

      // Log failed tokens for debugging
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx: number) => {
          if (!resp.success && resp.error) {
            void this.loggingService.log(
              LogType.NOTIFICATION,
              LogLevel.WARN,
              'Failed to send to device',
              'PushNotificationService',
              {
                deviceToken: this.maskToken(deviceTokens[idx] || ''),
                error: resp.error.message,
              }
            );
          }
        });
      }

      // If some failed, try SNS backup for failed tokens
      if (response.failureCount > 0 && this.snsBackupService?.isHealthy()) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx: number) => {
          if (!resp.success && deviceTokens[idx]) {
            failedTokens.push(deviceTokens[idx] || '');
          }
        });

        // Retry failed tokens with SNS
        for (const failedToken of failedTokens) {
          try {
            const snsResult = await this.sendViaSNS(failedToken, notification);
            if (snsResult.success) {
              // Update counts
              response.successCount++;
              response.failureCount--;
            }
          } catch (error) {
            // Log but don't fail - individual token failures are expected
            void this.loggingService.log(
              LogType.NOTIFICATION,
              LogLevel.DEBUG,
              'SNS fallback failed for individual token',
              'PushNotificationService',
              {
                deviceToken: this.maskToken(failedToken),
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
          }
        }
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        provider: response.failureCount === 0 ? 'fcm' : 'fcm', // Mixed if fallback used
        usedFallback: response.failureCount < deviceTokens.length - response.successCount,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send push notifications to multiple devices',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          tokenCount: deviceTokens.length,
          title: notification.title,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sends push notification to a topic
   * @param topic - Firebase topic name
   * @param notification - Notification data
   * @returns Promise resolving to notification result
   */
  async sendToTopic(
    topic: string,
    notification: PushNotificationData
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Push notification service is not initialized, skipping notification',
        'PushNotificationService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const message: admin.messaging.Message = {
        topic: topic,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data || {},
        android: {
          notification: {
            channelId: 'healthcare_notifications',
            priority: 'high' as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      };

      const response = await admin.messaging().send(message);

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Push notification sent to topic',
        'PushNotificationService',
        {
          messageId: response,
          topic,
          title: notification.title,
        }
      );

      return { success: true, messageId: response };
    } catch (error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send push notification to topic',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          topic,
          title: notification.title,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Subscribes a device to a topic
   * @param deviceToken - Firebase device token
   * @param topic - Topic name to subscribe to
   * @returns Promise resolving to true if successful
   */
  async subscribeToTopic(deviceToken: string, topic: string): Promise<boolean> {
    if (!this.isInitialized || !this.firebaseApp) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Push notification service is not initialized',
        'PushNotificationService'
      );
      return false;
    }

    try {
      await admin.messaging().subscribeToTopic([deviceToken], topic);

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Device subscribed to topic',
        'PushNotificationService',
        {
          deviceToken: this.maskToken(deviceToken),
          topic,
        }
      );

      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to subscribe device to topic',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          deviceToken: this.maskToken(deviceToken),
          topic,
        }
      );
      return false;
    }
  }

  /**
   * Unsubscribes a device from a topic
   * @param deviceToken - Firebase device token
   * @param topic - Topic name to unsubscribe from
   * @returns Promise resolving to true if successful
   */
  async unsubscribeFromTopic(deviceToken: string, topic: string): Promise<boolean> {
    if (!this.isInitialized || !this.firebaseApp) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Push notification service is not initialized',
        'PushNotificationService'
      );
      return false;
    }

    try {
      await admin.messaging().unsubscribeFromTopic([deviceToken], topic);

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Device unsubscribed from topic',
        'PushNotificationService',
        {
          deviceToken: this.maskToken(deviceToken),
          topic,
        }
      );

      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to unsubscribe device from topic',
        'PushNotificationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          deviceToken: this.maskToken(deviceToken),
          topic,
        }
      );
      return false;
    }
  }

  /**
   * Masks device token for logging (privacy)
   * @param token - Device token to mask
   * @returns Masked token string
   * @private
   */
  private maskToken(token: string): string {
    if (!token || token.length < 10) return 'INVALID_TOKEN';
    return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
  }

  /**
   * Checks if the push notification service is healthy and initialized
   * @returns True if service is ready to send notifications
   */
  isHealthy(): boolean {
    return this.isInitialized;
  }
}
