/**
 * DTOs module exports
 * @module DTOs
 * @description Centralized exports for all Data Transfer Objects
 * @example
 * ```typescript
 * import { CreateUserDto, LoginDto, AppointmentResponseDto } from "@dtos";
 * ```
 */

// Export all DTOs
export * from './user.dto';
export * from './auth.dto';
export * from './common-response.dto';
export * from './appointment.dto';
export * from './clinic.dto';
export * from './health.dto';
// Export notification DTOs with explicit naming to avoid conflicts
export {
  NotificationType as NotificationChannelType,
  MessageType,
  Platform,
  SendPushNotificationDto,
  SendMultiplePushNotificationsDto,
  SendTopicNotificationDto,
  SendEmailDto,
  AppointmentReminderDto,
  PrescriptionNotificationDto,
  ChatBackupDto,
  UnifiedNotificationDto,
  SubscribeToTopicDto,
  RegisterDeviceTokenDto,
  GetMessageHistoryDto,
  NotificationResponseDto,
  MessageHistoryResponseDto,
  NotificationStatsResponseDto,
  // Notification Preference DTOs
  QuietHoursDto,
  CategoryPreferencesDto,
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceResponseDto,
} from './notification.dto';
export * from './permission.dto';
export * from './role.dto';
export * from './video.dto';
export * from './billing.dto';
export * from './ehr.dto';
