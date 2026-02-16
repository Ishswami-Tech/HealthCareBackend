import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import * as admin from 'firebase-admin';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { SNSBackupService } from '@communication/channels/push/sns-backup.service';
import { DeviceTokenService } from '@communication/channels/push/device-token.service';

export interface PushNotificationData {
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  initiatorId?: string;
  initiatorRole?: string;
}

export interface PushNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  usedFallback?: boolean;
  successCount?: number;
  failureCount?: number;
  results?: Array<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;
  private snsBackupService?: SNSBackupService;
  private deviceTokenService?: DeviceTokenService;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SNSBackupService))
    snsBackupService?: SNSBackupService,
    @Inject(forwardRef(() => DeviceTokenService))
    deviceTokenService?: DeviceTokenService
  ) {
    if (snsBackupService !== undefined) {
      this.snsBackupService = snsBackupService;
    }
    if (deviceTokenService !== undefined) {
      this.deviceTokenService = deviceTokenService;
    }
  }

  onModuleInit(): void {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    try {
      const projectId = this.configService.getEnv('FIREBASE_PROJECT_ID');
      const privateKey = this.configService.getEnv('FIREBASE_PRIVATE_KEY');
      const clientEmail = this.configService.getEnv('FIREBASE_CLIENT_EMAIL');

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

  async sendToDevice(
    deviceToken: string,
    notification: PushNotificationData,
    userId?: string
  ): Promise<PushNotificationResult> {
    const fcmResult = await this.sendViaFCM(deviceToken, notification, userId);

    if (fcmResult.success) {
      return {
        ...fcmResult,
        provider: 'fcm',
        usedFallback: false,
      };
    }

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
        initiatorId: notification.initiatorId,
        initiatorRole: notification.initiatorRole,
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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
        }
      );
    }

    return {
      ...snsResult,
      provider: 'sns',
      usedFallback: true,
    };
  }

  private async sendViaFCM(
    deviceToken: string,
    notification: PushNotificationData,
    userId?: string
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
        webpush: {
          notification: {
            title: notification.title,
            body: notification.body,
            icon: '/icon-192x192.png', // Default icon path
            badge: '/badge-72x72.png',
          },
          fcmOptions: {
            link:
              notification.data && 'link' in notification.data
                ? String(notification.data['link'])
                : '/', // Deep link from data payload
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
          userId,
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
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
          userId,
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async sendViaSNS(
    deviceToken: string,
    notification: PushNotificationData,
    userId?: string
  ): Promise<PushNotificationResult> {
    if (!this.snsBackupService || !this.snsBackupService.isHealthy()) {
      return {
        success: false,
        error: 'SNS backup service not available',
      };
    }

    let platform: 'ios' | 'android' = 'android';

    if (this.deviceTokenService && userId) {
      const userTokens = this.deviceTokenService.getUserTokens(userId);
      const tokenData = userTokens.find(token => token.token === deviceToken);
      if (tokenData) {
        platform = tokenData.platform === 'ios' ? 'ios' : 'android';
      }
    }

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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
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
                initiatorId: notification.initiatorId,
                initiatorRole: notification.initiatorRole,
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
                initiatorId: notification.initiatorId,
                initiatorRole: notification.initiatorRole,
              }
            );
          }
        }
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        provider: response.failureCount === 0 ? 'fcm' : 'fcm',
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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
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
          initiatorId: notification.initiatorId,
          initiatorRole: notification.initiatorRole,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

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

  private maskToken(token: string): string {
    if (!token || token.length < 10) return 'INVALID_TOKEN';
    return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
  }

  isHealthy(): boolean {
    return this.isInitialized;
  }
}
