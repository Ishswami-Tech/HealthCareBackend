import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsObject,
  IsNumber,
  IsEmail,
  ValidateNested,
  ArrayMinSize,
  Length,
  Matches,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Notification type enumeration
 * @enum {string} NotificationType
 * @description Defines the types of notifications that can be sent
 * @example NotificationType.PUSH
 */
export enum NotificationType {
  PUSH = "push",
  EMAIL = "email",
  BOTH = "both",
}

/**
 * Message type enumeration
 * @enum {string} MessageType
 * @description Defines the types of messages in chat system
 * @example MessageType.TEXT
 */
export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  FILE = "file",
  AUDIO = "audio",
  VIDEO = "video",
}

/**
 * Platform enumeration
 * @enum {string} Platform
 * @description Defines the supported mobile platforms
 * @example Platform.IOS
 */
export enum Platform {
  IOS = "ios",
  ANDROID = "android",
}

export class SendPushNotificationDto {
  @ApiProperty({ description: "Device token for push notification" })
  @IsString()
  @Length(10, 2000)
  deviceToken!: string;

  @ApiProperty({ description: "Notification title" })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({ description: "Notification body" })
  @IsString()
  @Length(1, 500)
  body!: string;

  @ApiPropertyOptional({ description: "Additional data payload" })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;

  @ApiPropertyOptional({ description: "Device platform", enum: Platform })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}

export class SendMultiplePushNotificationsDto {
  @ApiProperty({ description: "Array of device tokens", type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  deviceTokens!: string[];

  @ApiProperty({ description: "Notification title" })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({ description: "Notification body" })
  @IsString()
  @Length(1, 500)
  body!: string;

  @ApiPropertyOptional({ description: "Additional data payload" })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class SendTopicNotificationDto {
  @ApiProperty({ description: "Topic name to send notification to" })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9-_.~%]+$/, {
    message:
      "Topic name can only contain alphanumeric characters, hyphens, underscores, periods, tildes, and percent signs",
  })
  topic!: string;

  @ApiProperty({ description: "Notification title" })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({ description: "Notification body" })
  @IsString()
  @Length(1, 500)
  body!: string;

  @ApiPropertyOptional({ description: "Additional data payload" })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;
}

export class SendEmailDto {
  @ApiProperty({ description: "Recipient email address" })
  @IsEmail()
  to!: string;

  @ApiProperty({ description: "Email subject" })
  @IsString()
  @Length(1, 200)
  subject!: string;

  @ApiProperty({ description: "Email body content" })
  @IsString()
  @Length(1, 50000)
  body!: string;

  @ApiPropertyOptional({
    description: "Whether the email body is HTML",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(
    ({ value }: { value: unknown }) => value === "true" || value === true,
  )
  isHtml?: boolean;

  @ApiPropertyOptional({ description: "Reply-to email address" })
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiPropertyOptional({ description: "CC email addresses", type: [String] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional({ description: "BCC email addresses", type: [String] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  bcc?: string[];
}

export class AppointmentReminderDto {
  @ApiProperty({ description: "Patient email address" })
  @IsEmail()
  to!: string;

  @ApiProperty({ description: "Patient name" })
  @IsString()
  @Length(1, 100)
  patientName!: string;

  @ApiProperty({ description: "Doctor name" })
  @IsString()
  @Length(1, 100)
  doctorName!: string;

  @ApiProperty({ description: "Appointment date (YYYY-MM-DD)" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "Date must be in YYYY-MM-DD format",
  })
  date!: string;

  @ApiProperty({ description: "Appointment time (HH:MM AM/PM)" })
  @IsString()
  @Length(1, 20)
  time!: string;

  @ApiProperty({ description: "Appointment location" })
  @IsString()
  @Length(1, 200)
  location!: string;

  @ApiPropertyOptional({ description: "Appointment ID for reference" })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiPropertyOptional({ description: "Device token for push notification" })
  @IsOptional()
  @IsString()
  deviceToken?: string;
}

export class PrescriptionNotificationDto {
  @ApiProperty({ description: "Patient email address" })
  @IsEmail()
  to!: string;

  @ApiProperty({ description: "Patient name" })
  @IsString()
  @Length(1, 100)
  patientName!: string;

  @ApiProperty({ description: "Doctor name" })
  @IsString()
  @Length(1, 100)
  doctorName!: string;

  @ApiProperty({ description: "Prescription ID" })
  @IsString()
  @Length(1, 50)
  prescriptionId!: string;

  @ApiProperty({ description: "List of medications", type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  medications!: string[];

  @ApiPropertyOptional({ description: "Special pickup instructions" })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  pickupInstructions?: string;

  @ApiPropertyOptional({ description: "Device token for push notification" })
  @IsOptional()
  @IsString()
  deviceToken?: string;
}

export class ChatBackupDto {
  @ApiProperty({ description: "Unique message ID" })
  @IsString()
  @Length(1, 100)
  id!: string;

  @ApiProperty({ description: "Sender user ID" })
  @IsString()
  @Length(1, 100)
  senderId!: string;

  @ApiProperty({ description: "Receiver user ID" })
  @IsString()
  @Length(1, 100)
  receiverId!: string;

  @ApiProperty({ description: "Message content" })
  @IsString()
  @Length(1, 10000)
  content!: string;

  @ApiProperty({
    description: "Message timestamp (Unix timestamp in milliseconds)",
  })
  @IsNumber()
  @Type(() => Number)
  timestamp!: number;

  @ApiProperty({ description: "Message type", enum: MessageType })
  @IsEnum(MessageType)
  type!: MessageType;

  @ApiPropertyOptional({ description: "Additional message metadata" })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => Object)
  metadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    duration?: number;
    threadId?: string;
    replyToMessageId?: string;
  };
}

export class UnifiedNotificationDto {
  @ApiProperty({
    description: "Type of notification to send",
    enum: NotificationType,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ description: "Notification title" })
  @IsString()
  @Length(1, 100)
  title!: string;

  @ApiProperty({ description: "Notification body" })
  @IsString()
  @Length(1, 500)
  body!: string;

  @ApiPropertyOptional({
    description: "Device token (required for push notifications)",
  })
  @IsOptional()
  @IsString()
  deviceToken?: string;

  @ApiPropertyOptional({
    description: "Email address (required for email notifications)",
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: "Additional data payload" })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;

  @ApiPropertyOptional({
    description: "Use backup service if primary fails",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(
    ({ value }: { value: unknown }) => value === "true" || value === true,
  )
  useBackup?: boolean;
}

export class SubscribeToTopicDto {
  @ApiProperty({ description: "Device token to subscribe" })
  @IsString()
  @Length(10, 2000)
  deviceToken!: string;

  @ApiProperty({ description: "Topic name to subscribe to" })
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-zA-Z0-9-_.~%]+$/, {
    message:
      "Topic name can only contain alphanumeric characters, hyphens, underscores, periods, tildes, and percent signs",
  })
  topic!: string;
}

export class GetMessageHistoryDto {
  @ApiProperty({ description: "User ID to get message history for" })
  @IsString()
  @Length(1, 100)
  userId!: string;

  @ApiPropertyOptional({ description: "Conversation partner ID" })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  conversationPartnerId?: string;

  @ApiPropertyOptional({
    description: "Maximum number of messages to retrieve",
    default: 50,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Transform(({ value }: { value: unknown }) =>
    Math.min(Math.max(parseInt(String(value)) || 50, 1), 1000),
  )
  limit?: number;

  @ApiPropertyOptional({ description: "Get messages before this timestamp" })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  startAfter?: number;
}

export class NotificationResponseDto {
  @ApiProperty({ description: "Whether the operation was successful" })
  success!: boolean;

  @ApiPropertyOptional({ description: "Message ID if successful" })
  messageId?: string;

  @ApiPropertyOptional({ description: "Success count for bulk operations" })
  successCount?: number;

  @ApiPropertyOptional({ description: "Failure count for bulk operations" })
  failureCount?: number;

  @ApiPropertyOptional({ description: "Error message if failed" })
  error?: string;

  @ApiPropertyOptional({ description: "Additional metadata" })
  metadata?: Record<string, unknown>;
}

export class MessageHistoryResponseDto {
  @ApiProperty({ description: "Whether the operation was successful" })
  success!: boolean;

  @ApiPropertyOptional({ description: "Retrieved messages" })
  messages?: Record<string, unknown>;

  @ApiPropertyOptional({ description: "Number of messages retrieved" })
  count?: number;

  @ApiPropertyOptional({ description: "Error message if failed" })
  error?: string;
}

export class NotificationStatsResponseDto {
  @ApiProperty({ description: "Total number of notifications sent" })
  totalNotifications!: number;

  @ApiProperty({ description: "Notifications sent in the last 24 hours" })
  notificationsLast24h!: number;

  @ApiProperty({ description: "Notifications sent in the last 7 days" })
  notificationsLast7d!: number;

  @ApiProperty({ description: "Success rate percentage" })
  successRate!: number;

  @ApiPropertyOptional({ description: "Service health status" })
  services?: {
    firebase?: boolean;
    awsSes?: boolean;
    awsSns?: boolean;
    firebaseDatabase?: boolean;
  };
}
