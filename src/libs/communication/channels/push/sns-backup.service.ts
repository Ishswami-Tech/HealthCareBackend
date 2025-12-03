import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import {
  SNSClient,
  PublishCommand,
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  SetEndpointAttributesCommand,
} from '@aws-sdk/client-sns';
import {
  PushNotificationData,
  PushNotificationResult,
} from '@communication/channels/push/push.service';

export interface SNSPlatformEndpoint {
  endpointArn: string;
  deviceToken: string;
  platform: 'ios' | 'android';
}

@Injectable()
export class SNSBackupService implements OnModuleInit {
  private snsClient: SNSClient | null = null;
  private isInitialized = false;
  private platformApplicationArn: {
    ios?: string;
    android?: string;
  } = {};

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.initializeAWSSNS();
  }

  private initializeAWSSNS(): void {
    try {
      const awsRegion = this.configService.get<string>('AWS_REGION');
      const awsAccessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
      const awsSecretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

      if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'AWS credentials not provided, SNS backup service will be disabled',
          'SNSBackupService'
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
      this.platformApplicationArn.ios =
        this.configService.get<string>('AWS_SNS_IOS_PLATFORM_ARN') || '';
      this.platformApplicationArn.android =
        this.configService.get<string>('AWS_SNS_ANDROID_PLATFORM_ARN') || '';

      if (!this.platformApplicationArn.ios && !this.platformApplicationArn.android) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'No platform application ARNs configured, SNS backup service will be limited',
          'SNSBackupService'
        );
      }

      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'AWS SNS backup service initialized successfully',
        'SNSBackupService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to initialize AWS SNS: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SNSBackupService',
        { stack: (error as Error)?.stack }
      );
      this.isInitialized = false;
    }
  }

  async sendPushNotification(
    deviceToken: string,
    notification: PushNotificationData,
    platform: 'ios' | 'android' = 'android'
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.snsClient) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'SNS backup service is not initialized, skipping notification',
        'SNSBackupService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      // Create platform endpoint if needed
      const endpointArn = await this.createOrGetPlatformEndpoint(deviceToken, platform);
      if (!endpointArn) {
        return { success: false, error: 'Failed to create platform endpoint' };
      }

      // Prepare platform-specific payload
      const message = this.createPlatformMessage(notification, platform);

      const command = new PublishCommand({
        TargetArn: endpointArn,
        Message: JSON.stringify(message),
        MessageStructure: 'json',
      });

      const response = await this.snsClient.send(command);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'SNS push notification sent successfully',
        'SNSBackupService',
        {
          messageId: response.MessageId,
          platform,
          deviceToken: this.maskToken(deviceToken),
          title: notification.title,
        }
      );

      return {
        success: true,
        ...(response.MessageId && { messageId: response.MessageId }),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send SNS push notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SNSBackupService',
        {
          stack: (error as Error)?.stack,
          platform,
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

  async sendToMultiplePlatformEndpoints(
    endpoints: SNSPlatformEndpoint[],
    notification: PushNotificationData
  ): Promise<PushNotificationResult> {
    if (!this.isInitialized || !this.snsClient) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'SNS backup service is not initialized',
        'SNSBackupService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    const promises = endpoints.map(async endpoint => {
      try {
        const result = await this.sendToEndpoint(
          endpoint.endpointArn,
          notification,
          endpoint.platform
        );
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          if (result.error) {
            errors.push(`${this.maskToken(endpoint.deviceToken)}: ${result.error}`);
          }
        }
      } catch (error) {
        failureCount++;
        errors.push(
          `${this.maskToken(endpoint.deviceToken)}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    await Promise.all(promises);

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'SNS bulk push notifications completed',
      'SNSBackupService',
      {
        successCount,
        failureCount,
        totalEndpoints: endpoints.length,
        title: notification.title,
      }
    );

    return {
      success: successCount > 0,
      successCount,
      failureCount,
      ...(errors.length > 0 && { error: errors.join('; ') }),
    };
  }

  private async sendToEndpoint(
    endpointArn: string,
    notification: PushNotificationData,
    platform: 'ios' | 'android'
  ): Promise<PushNotificationResult> {
    if (!this.snsClient) {
      return { success: false, error: 'SNS client not initialized' };
    }

    try {
      const message = this.createPlatformMessage(notification, platform);

      const command = new PublishCommand({
        TargetArn: endpointArn,
        Message: JSON.stringify(message),
        MessageStructure: 'json',
      });

      const response = await this.snsClient.send(command);
      return {
        success: true,
        ...(response.MessageId && { messageId: response.MessageId }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async createOrGetPlatformEndpoint(
    deviceToken: string,
    platform: 'ios' | 'android'
  ): Promise<string | null> {
    if (!this.snsClient) {
      return null;
    }

    try {
      const platformArn = this.platformApplicationArn[platform];
      if (!platformArn) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Platform application ARN not configured for ${platform}`,
          'SNSBackupService'
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

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        'Platform endpoint created',
        'SNSBackupService',
        {
          endpointArn: response.EndpointArn,
          platform,
          deviceToken: this.maskToken(deviceToken),
        }
      );

      return response.EndpointArn || null;
    } catch (error) {
      // If endpoint already exists, try to get it
      if (error instanceof Error && error.message.includes('already exists')) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          'Platform endpoint already exists',
          'SNSBackupService',
          {
            platform,
            deviceToken: this.maskToken(deviceToken),
          }
        );
        // In a real implementation, you would need to store endpoint ARNs
        // or implement a method to retrieve existing endpoints
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to create platform endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SNSBackupService',
        { platform, deviceToken: this.maskToken(deviceToken) }
      );
      return null;
    }
  }

  private createPlatformMessage(
    notification: PushNotificationData,
    platform: 'ios' | 'android'
  ): Record<string, string> {
    const baseMessage = {
      default: notification.body,
    };

    if (platform === 'ios') {
      return {
        ...baseMessage,
        APNS: JSON.stringify({
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            badge: 1,
            sound: 'default',
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
            sound: 'default',
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
            icon: 'healthcare_icon',
            color: '#4CAF50',
          },
          data: {
            ...notification.data,
            title: notification.title,
            body: notification.body,
          },
          android: {
            notification: {
              channel_id: 'healthcare_notifications',
              priority: 'high',
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

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Platform endpoint deleted',
        'SNSBackupService',
        { endpointArn }
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to delete platform endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SNSBackupService',
        { endpointArn }
      );
      return false;
    }
  }

  async updateEndpointToken(endpointArn: string, newDeviceToken: string): Promise<boolean> {
    if (!this.snsClient) {
      return false;
    }

    try {
      const command = new SetEndpointAttributesCommand({
        EndpointArn: endpointArn,
        Attributes: {
          Token: newDeviceToken,
          Enabled: 'true',
        },
      });

      await this.snsClient.send(command);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Platform endpoint token updated',
        'SNSBackupService',
        { endpointArn, newToken: this.maskToken(newDeviceToken) }
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update platform endpoint token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SNSBackupService',
        { endpointArn, newToken: this.maskToken(newDeviceToken) }
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
