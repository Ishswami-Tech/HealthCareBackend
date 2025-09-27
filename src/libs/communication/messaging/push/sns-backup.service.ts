import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SNSClient,
  PublishCommand,
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  SetEndpointAttributesCommand,
} from "@aws-sdk/client-sns";
import { PushNotificationData, PushNotificationResult } from "./push.service";

export interface SNSPlatformEndpoint {
  endpointArn: string;
  deviceToken: string;
  platform: "ios" | "android";
}

@Injectable()
export class SNSBackupService implements OnModuleInit {
  private readonly logger = new Logger(SNSBackupService.name);
  private snsClient: SNSClient | null = null;
  private isInitialized = false;
  private platformApplicationArn: {
    ios?: string;
    android?: string;
  } = {};

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.initializeAWSSNS();
  }

  private initializeAWSSNS(): void {
    try {
      const awsRegion = this.configService.get<string>("AWS_REGION");
      const awsAccessKeyId =
        this.configService.get<string>("AWS_ACCESS_KEY_ID");
      const awsSecretAccessKey = this.configService.get<string>(
        "AWS_SECRET_ACCESS_KEY",
      );

      if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
        this.logger.warn(
          "AWS credentials not provided, SNS backup service will be disabled",
        );
        this.isInitialized = false;
        return;
      }

      this.snsClient = new SNSClient({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      });

      // Get platform application ARNs from config
      this.platformApplicationArn.ios = this.configService.get<string>(
        "AWS_SNS_IOS_PLATFORM_ARN",
      );
      this.platformApplicationArn.android = this.configService.get<string>(
        "AWS_SNS_ANDROID_PLATFORM_ARN",
      );

      if (
        !this.platformApplicationArn.ios &&
        !this.platformApplicationArn.android
      ) {
        this.logger.warn(
          "No platform application ARNs configured, SNS backup service will be limited",
        );
      }

      this.isInitialized = true;
      this.logger.log("AWS SNS backup service initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize AWS SNS:", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.isInitialized = false;
    }
  }

  async sendPushNotification(
    deviceToken: string,
    notification: PushNotificationData,
    platform: "ios" | "android" = "android",
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.snsClient) {
      this.logger.warn(
        "SNS backup service is not initialized, skipping notification",
      );
      return { success: false, error: "Service not initialized" };
    }

    try {
      // Create platform endpoint if needed
      const endpointArn = await this.createOrGetPlatformEndpoint(
        deviceToken,
        platform,
      );
      if (!endpointArn) {
        return { success: false, error: "Failed to create platform endpoint" };
      }

      // Prepare platform-specific payload
      const message = this.createPlatformMessage(notification, platform);

      const command = new PublishCommand({
        TargetArn: endpointArn,
        Message: JSON.stringify(message),
        MessageStructure: "json",
      });

      const response = await this.snsClient.send(command);

      this.logger.log("SNS push notification sent successfully", {
        messageId: response.MessageId,
        platform,
        deviceToken: this.maskToken(deviceToken),
        title: notification.title,
      });

      return { success: true, messageId: response.MessageId };
    } catch (error) {
      this.logger.error("Failed to send SNS push notification", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        platform,
        deviceToken: this.maskToken(deviceToken),
        title: notification.title,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendToMultiplePlatformEndpoints(
    endpoints: SNSPlatformEndpoint[],
    notification: PushNotificationData,
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.snsClient) {
      this.logger.warn("SNS backup service is not initialized");
      return { success: false, error: "Service not initialized" };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    const promises = endpoints.map(async (endpoint) => {
      try {
        const result = await this.sendToEndpoint(
          endpoint.endpointArn,
          notification,
          endpoint.platform,
        );
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          if (result.error) {
            errors.push(
              `${this.maskToken(endpoint.deviceToken)}: ${result.error}`,
            );
          }
        }
      } catch (error) {
        failureCount++;
        errors.push(
          `${this.maskToken(endpoint.deviceToken)}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    });

    await Promise.all(promises);

    this.logger.log("SNS bulk push notifications completed", {
      successCount,
      failureCount,
      totalEndpoints: endpoints.length,
      title: notification.title,
    });

    return {
      success: successCount > 0,
      successCount,
      failureCount,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  }

  private async sendToEndpoint(
    endpointArn: string,
    notification: PushNotificationData,
    platform: "ios" | "android",
  ): Promise<PushNotificationResult> {
    if (!this.snsClient) {
      return { success: false, error: "SNS client not initialized" };
    }

    try {
      const message = this.createPlatformMessage(notification, platform);

      const command = new PublishCommand({
        TargetArn: endpointArn,
        Message: JSON.stringify(message),
        MessageStructure: "json",
      });

      const response = await this.snsClient.send(command);
      return { success: true, messageId: response.MessageId };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async createOrGetPlatformEndpoint(
    deviceToken: string,
    platform: "ios" | "android",
  ): Promise<string | null> {
    if (!this.snsClient) {
      return null;
    }

    try {
      const platformArn = this.platformApplicationArn[platform];
      if (!platformArn) {
        this.logger.warn(
          `Platform application ARN not configured for ${platform}`,
        );
        return null;
      }

      const command = new CreatePlatformEndpointCommand({
        PlatformApplicationArn: platformArn,
        Token: deviceToken,
        CustomUserData: JSON.stringify({
          platform,
          createdAt: new Date().toISOString(),
        }),
      });

      const response = await this.snsClient.send(command);

      this.logger.debug("Platform endpoint created", {
        endpointArn: response.EndpointArn,
        platform,
        deviceToken: this.maskToken(deviceToken),
      });

      return response.EndpointArn || null;
    } catch (error) {
      // If endpoint already exists, try to get it
      if (error instanceof Error && error.message.includes("already exists")) {
        this.logger.debug("Platform endpoint already exists", {
          platform,
          deviceToken: this.maskToken(deviceToken),
        });
        // In a real implementation, you would need to store endpoint ARNs
        // or implement a method to retrieve existing endpoints
      }

      this.logger.error("Failed to create platform endpoint", {
        error: error instanceof Error ? error.message : "Unknown error",
        platform,
        deviceToken: this.maskToken(deviceToken),
      });
      return null;
    }
  }

  private createPlatformMessage(
    notification: PushNotificationData,
    platform: "ios" | "android",
  ): Record<string, string> {
    const baseMessage = {
      default: notification.body,
    };

    if (platform === "ios") {
      return {
        ...baseMessage,
        APNS: JSON.stringify({
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            badge: 1,
            sound: "default",
          },
          ...(notification.data && { customData: notification.data }),
        }),
        APNS_SANDBOX: JSON.stringify({
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            badge: 1,
            sound: "default",
          },
          ...(notification.data && { customData: notification.data }),
        }),
      };
    } else {
      return {
        ...baseMessage,
        GCM: JSON.stringify({
          notification: {
            title: notification.title,
            body: notification.body,
            icon: "healthcare_icon",
            color: "#4CAF50",
          },
          data: {
            ...notification.data,
            title: notification.title,
            body: notification.body,
          },
          android: {
            notification: {
              channel_id: "healthcare_notifications",
              priority: "high",
            },
          },
        }),
      };
    }
  }

  async deleteEndpoint(endpointArn: string): Promise<boolean> {
    if (!this.snsClient) {
      return false;
    }

    try {
      const command = new DeleteEndpointCommand({
        EndpointArn: endpointArn,
      });

      await this.snsClient.send(command);

      this.logger.log("Platform endpoint deleted", { endpointArn });
      return true;
    } catch (error) {
      this.logger.error("Failed to delete platform endpoint", {
        error: error instanceof Error ? error.message : "Unknown error",
        endpointArn,
      });
      return false;
    }
  }

  async updateEndpointToken(
    endpointArn: string,
    newDeviceToken: string,
  ): Promise<boolean> {
    if (!this.snsClient) {
      return false;
    }

    try {
      const command = new SetEndpointAttributesCommand({
        EndpointArn: endpointArn,
        Attributes: {
          Token: newDeviceToken,
          Enabled: "true",
        },
      });

      await this.snsClient.send(command);

      this.logger.log("Platform endpoint token updated", {
        endpointArn,
        newToken: this.maskToken(newDeviceToken),
      });
      return true;
    } catch (error) {
      this.logger.error("Failed to update platform endpoint token", {
        error: error instanceof Error ? error.message : "Unknown error",
        endpointArn,
        newToken: this.maskToken(newDeviceToken),
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
