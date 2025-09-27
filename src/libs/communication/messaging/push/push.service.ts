import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as admin from "firebase-admin";

export interface PushNotificationData {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushNotificationResult {
  success: boolean;
  messageId?: string;
  successCount?: number;
  failureCount?: number;
  error?: string;
}

@Injectable()
export class PushNotificationService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationService.name);
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.initializeFirebase();
  }

  private initializeFirebase(): void {
    try {
      const projectId = this.configService.get<string>("FIREBASE_PROJECT_ID");
      const privateKey = this.configService.get<string>("FIREBASE_PRIVATE_KEY");
      const clientEmail = this.configService.get<string>(
        "FIREBASE_CLIENT_EMAIL",
      );

      if (!projectId || !privateKey || !clientEmail) {
        this.logger.warn(
          "Firebase credentials not provided, push notification service will be disabled",
        );
        this.isInitialized = false;
        return;
      }

      // Initialize Firebase Admin SDK if not already initialized
      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, "\n"),
            clientEmail,
          }),
        });
      } else {
        this.firebaseApp = admin.app();
      }

      this.isInitialized = true;
      this.logger.log(
        "Firebase push notification service initialized successfully",
      );
    } catch (error) {
      this.logger.error("Failed to initialize Firebase:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.isInitialized = false;
    }
  }

  async sendToDevice(
    deviceToken: string,
    notification: PushNotificationData,
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.warn(
        "Push notification service is not initialized, skipping notification",
      );
      return { success: false, error: "Service not initialized" };
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
            channelId: "healthcare_notifications",
            priority: "high" as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: "default",
            },
          },
        },
      };

      const response = await admin.messaging().send(message);

      this.logger.log("Push notification sent successfully", {
        messageId: response,
        deviceToken: this.maskToken(deviceToken),
        title: notification.title,
      });

      return { success: true, messageId: response };
    } catch (error) {
      this.logger.error("Failed to send push notification", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        deviceToken: this.maskToken(deviceToken),
        title: notification.title,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendToMultipleDevices(
    deviceTokens: string[],
    notification: PushNotificationData,
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.warn(
        "Push notification service is not initialized, skipping notification",
      );
      return { success: false, error: "Service not initialized" };
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
            channelId: "healthcare_notifications",
            priority: "high" as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: "default",
            },
          },
        },
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      this.logger.log("Push notifications sent to multiple devices", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: deviceTokens.length,
        title: notification.title,
      });

      // Log failed tokens for debugging
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx: number) => {
          if (!resp.success && resp.error) {
            this.logger.warn("Failed to send to device", {
              deviceToken: this.maskToken(deviceTokens[idx]),
              error: resp.error.message,
            });
          }
        });
      }

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      this.logger.error(
        "Failed to send push notifications to multiple devices",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          tokenCount: deviceTokens.length,
          title: notification.title,
        },
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendToTopic(
    topic: string,
    notification: PushNotificationData,
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.warn(
        "Push notification service is not initialized, skipping notification",
      );
      return { success: false, error: "Service not initialized" };
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
            channelId: "healthcare_notifications",
            priority: "high" as const,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: "default",
            },
          },
        },
      };

      const response = await admin.messaging().send(message);

      this.logger.log("Push notification sent to topic", {
        messageId: response,
        topic,
        title: notification.title,
      });

      return { success: true, messageId: response };
    } catch (error) {
      this.logger.error("Failed to send push notification to topic", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        topic,
        title: notification.title,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async subscribeToTopic(deviceToken: string, topic: string): Promise<boolean> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.warn("Push notification service is not initialized");
      return false;
    }

    try {
      await admin.messaging().subscribeToTopic([deviceToken], topic);

      this.logger.log("Device subscribed to topic", {
        deviceToken: this.maskToken(deviceToken),
        topic,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to subscribe device to topic", {
        error: error instanceof Error ? error.message : "Unknown error",
        deviceToken: this.maskToken(deviceToken),
        topic,
      });
      return false;
    }
  }

  async unsubscribeFromTopic(
    deviceToken: string,
    topic: string,
  ): Promise<boolean> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.warn("Push notification service is not initialized");
      return false;
    }

    try {
      await admin.messaging().unsubscribeFromTopic([deviceToken], topic);

      this.logger.log("Device unsubscribed from topic", {
        deviceToken: this.maskToken(deviceToken),
        topic,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to unsubscribe device from topic", {
        error: error instanceof Error ? error.message : "Unknown error",
        deviceToken: this.maskToken(deviceToken),
        topic,
      });
      return false;
    }
  }

  private maskToken(token: string): string {
    if (!token || token.length < 10) return "INVALID_TOKEN";
    return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
  }

  isHealthy(): boolean {
    return this.isInitialized;
  }
}
