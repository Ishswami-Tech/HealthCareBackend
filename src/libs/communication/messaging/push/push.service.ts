import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import * as admin from 'firebase-admin';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

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
}

/**
 * Push notification service using Firebase Cloud Messaging
 *
 * @class PushNotificationService
 * @implements {OnModuleInit}
 */
@Injectable()
export class PushNotificationService implements OnModuleInit {
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;

  /**
   * Creates an instance of PushNotificationService
   * @param configService - Configuration service for environment variables
   */
  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {}

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
      const projectId = this.configService?.get<string>('FIREBASE_PROJECT_ID') || process.env['FIREBASE_PROJECT_ID'];
      const privateKey = this.configService?.get<string>('FIREBASE_PRIVATE_KEY') || process.env['FIREBASE_PRIVATE_KEY'];
      const clientEmail = this.configService?.get<string>('FIREBASE_CLIENT_EMAIL') || process.env['FIREBASE_CLIENT_EMAIL'];

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
   * @param deviceToken - Firebase device token
   * @param notification - Notification data
   * @returns Promise resolving to notification result
   */
  async sendToDevice(
    deviceToken: string,
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
        'Push notification sent successfully',
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
        'Failed to send push notification',
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

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
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
