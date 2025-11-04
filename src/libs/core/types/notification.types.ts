/**
 * Centralized Notification Types
 * @module @core/types/notification.types
 * @description All notification-related types and interfaces for the healthcare system
 */

/**
 * Notification delivery result
 * @interface NotificationDeliveryResult
 * @description Result of sending a notification through multiple channels
 */
export interface NotificationDeliveryResult {
  /** Whether the notification was successfully sent through at least one channel */
  readonly success: boolean;
  /** Results from each notification channel attempted */
  readonly results: Array<{
    /** Type of notification channel */
    readonly type: 'push' | 'email' | 'push_backup';
    /** Result of the notification attempt */
    readonly result: {
      /** Whether this channel's notification was successful */
      readonly success: boolean;
      /** Optional message ID if successful */
      readonly messageId?: string;
      /** Optional error message if failed */
      readonly error?: string;
    };
  }>;
}

/**
 * Notification metrics
 * @interface NotificationMetrics
 * @description Aggregated metrics for notification services
 */
export interface NotificationMetrics {
  /** Total number of notifications sent */
  readonly totalSent: number;
  /** Number of successfully sent notifications */
  readonly successfulSent: number;
  /** Number of failed notifications */
  readonly failedSent: number;
  /** Metrics broken down by service type */
  readonly services: {
    /** Push notification metrics */
    readonly push: {
      /** Total sent */
      readonly sent: number;
      /** Successfully sent */
      readonly successful: number;
      /** Failed */
      readonly failed: number;
    };
    /** Email notification metrics */
    readonly email: {
      /** Total sent */
      readonly sent: number;
      /** Successfully sent */
      readonly successful: number;
      /** Failed */
      readonly failed: number;
    };
    /** Backup service metrics */
    readonly backup: {
      /** Total sent */
      readonly sent: number;
      /** Successfully sent */
      readonly successful: number;
      /** Failed */
      readonly failed: number;
    };
  };
}

/**
 * Notification service health status
 * @interface NotificationServiceHealthStatus
 * @description Health status of notification service dependencies
 */
export interface NotificationServiceHealthStatus {
  /** Firebase push notification service health */
  readonly firebase: boolean;
  /** AWS SES email service health */
  readonly awsSes: boolean;
  /** AWS SNS backup service health */
  readonly awsSns: boolean;
  /** Firebase database health */
  readonly firebaseDatabase: boolean;
}

/**
 * Unified notification response
 * @interface UnifiedNotificationResponse
 * @description Response structure for unified notification endpoint
 */
export interface UnifiedNotificationResponse {
  /** Whether the notification was successfully sent */
  readonly success: boolean;
  /** Results from each notification channel attempted */
  readonly results: Array<{
    /** Type of notification channel */
    readonly type: 'push' | 'email' | 'push_backup';
    /** Result of the notification attempt */
    readonly result: {
      /** Whether this channel's notification was successful */
      readonly success: boolean;
      /** Optional message ID if successful */
      readonly messageId?: string;
      /** Optional error message if failed */
      readonly error?: string;
    };
  }>;
  /** Metadata about the notification delivery */
  readonly metadata: {
    /** List of delivery channels attempted */
    readonly deliveryChannels: string[];
    /** List of successful delivery channels */
    readonly successfulChannels: string[];
  };
}

/**
 * Chat statistics response
 * @interface ChatStatsResponse
 * @description Statistics about chat message backups
 */
export interface ChatStatsResponse {
  /** Whether the statistics were retrieved successfully */
  readonly success: boolean;
  /** Total number of messages backed up */
  readonly totalMessages?: number;
  /** Number of messages backed up in the last 24 hours */
  readonly messagesLast24h?: number;
  /** Number of messages backed up in the last 7 days */
  readonly messagesLast7d?: number;
  /** Total storage used for chat backups in bytes */
  readonly totalStorageUsed?: number;
  /** Error message if retrieval failed */
  readonly error?: string;
}

/**
 * Notification health status response
 * @interface NotificationHealthStatusResponse
 * @description Health status response for notification services
 */
export interface NotificationHealthStatusResponse {
  /** Whether all notification services are healthy */
  readonly healthy: boolean;
  /** Health status of individual notification services */
  readonly services: NotificationServiceHealthStatus;
  /** Timestamp of the health check */
  readonly timestamp: string;
}

/**
 * Notification test system response
 * @interface NotificationTestSystemResponse
 * @description Response structure for notification system test endpoint
 */
export interface NotificationTestSystemResponse {
  /** Whether any tests passed */
  readonly success: boolean;
  /** Results of individual test cases */
  readonly tests: Record<string, { success: boolean; error?: string }>;
  /** Summary of test results */
  readonly summary: string;
}
