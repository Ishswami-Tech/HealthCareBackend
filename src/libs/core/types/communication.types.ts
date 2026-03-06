/**
 * Communication Types
 * @module @core/types/communication.types
 * @description Types for unified communication service
 */

/**
 * Communication channel types
 */
export type CommunicationChannel = 'socket' | 'push' | 'email' | 'sms' | 'whatsapp';

/**
 * Communication categories for smart channel selection
 */
export enum CommunicationCategory {
  LOGIN = 'login',
  EHR_RECORD = 'ehr_record',
  APPOINTMENT = 'appointment',
  REMINDER = 'reminder',
  BILLING = 'billing',
  CRITICAL = 'critical',
  SYSTEM = 'system',
  USER_ACTIVITY = 'user_activity',
  PRESCRIPTION = 'prescription',
  CHAT = 'chat',
}

/**
 * Delivery strategy for communication
 */
export enum DeliveryStrategy {
  IMMEDIATE = 'immediate', // Send immediately (synchronous)
  QUEUED = 'queued', // Queue for async processing
  SCHEDULED = 'scheduled', // Schedule for future delivery
  BATCHED = 'batched', // Batch multiple messages
}

/**
 * Communication priority
 */
export enum CommunicationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Communication request
 */
export interface CommunicationRequest {
  /** Communication category */
  category: CommunicationCategory;
  /** Title/subject of the communication */
  title: string;
  /** Body/content of the communication */
  body: string;
  /** Recipients */
  recipients: Array<{
    userId?: string;
    email?: string;
    phoneNumber?: string;
    deviceToken?: string;
    socketRoom?: string;
  }>;
  /** Preferred channels (if not specified, uses category defaults) */
  channels?: CommunicationChannel[];
  /** Delivery strategy */
  strategy?: DeliveryStrategy;
  /** Priority */
  priority?: CommunicationPriority;
  /** Additional data payload */
  data?: Record<string, unknown>;
  /** Template ID for templated messages */
  templateId?: string;
  /** Template variables */
  templateVariables?: Record<string, string>;
  /** Whether to respect user preferences */
  respectPreferences?: boolean;
  /** Whether to apply rate limiting */
  applyRateLimit?: boolean;
  /** Initiator user ID (for auditing) */
  initiatorId?: string;
  /** Initiator role (for auditing) */
  initiatorRole?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Channel delivery result
 */
export interface ChannelDeliveryResult {
  /** Channel used */
  channel: CommunicationChannel;
  /** Whether delivery was successful */
  success: boolean;
  /** Message ID if successful */
  messageId?: string;
  /** Error message if failed */
  error?: string;
  /** Delivery timestamp */
  timestamp: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Communication delivery result
 */
export interface CommunicationDeliveryResult {
  /** Overall success (at least one channel succeeded) */
  success: boolean;
  /** Request ID */
  requestId: string;
  /** Results from each channel */
  results: ChannelDeliveryResult[];
  /** Timestamp */
  timestamp: Date;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Category to channel mapping configuration
 */
export interface CategoryChannelConfig {
  /** Default channels for this category */
  defaultChannels: CommunicationChannel[];
  /** Required channels (always included) */
  requiredChannels?: CommunicationChannel[];
  /** Fallback channels if primary fails */
  fallbackChannels?: CommunicationChannel[];
  /** Delivery strategy */
  strategy: DeliveryStrategy;
  /** Priority */
  priority: CommunicationPriority;
  /** Rate limit configuration */
  rateLimit?: {
    limit: number;
    windowSeconds: number;
  };
}

/**
 * User communication preferences
 */
export interface UserCommunicationPreferences {
  /** User ID */
  userId: string;
  /** Enabled channels */
  enabledChannels: CommunicationChannel[];
  /** Disabled channels */
  disabledChannels: CommunicationChannel[];
  /** Category-specific preferences */
  categoryPreferences?: Record<string, CommunicationChannel[]>;
  /** Quiet hours (no notifications during these times) */
  quietHours?: {
    start: string; // HH:mm format
    end: string; // HH:mm format
    timezone: string;
  };
  /** Category enablement flags */
  appointmentEnabled?: boolean;
  ehrEnabled?: boolean;
  billingEnabled?: boolean;
  systemEnabled?: boolean;
}

/**
 * Comprehensive communication health status (used by CommunicationHealthMonitorService)
 * Provides detailed health information including Socket and Email connection status, metrics, etc.
 */
export interface CommunicationHealthMonitorStatus {
  healthy: boolean;
  socket: {
    connected: boolean;
    latency?: number;
    connectedClients?: number;
  };
  email: {
    connected: boolean;
    latency?: number;
    provider?: string;
  };
  whatsapp: {
    connected: boolean;
    latency?: number;
    enabled?: boolean;
  };
  push: {
    connected: boolean;
    latency?: number;
    provider?: string;
  };
  metrics: {
    socketConnections: number;
    emailQueueSize: number;
  };
  performance: {
    socketThroughput?: number;
    emailThroughput?: number;
  };
  issues: string[];
}

/**
 * Base email template payload data.
 */
export interface EmailTemplateData {
  patientName: string;
  clinicName?: string;
  [key: string]: string | number | boolean | undefined | readonly string[];
}

export interface AppointmentTemplateData extends EmailTemplateData {
  doctorName: string;
  appointmentDate: string;
  appointmentTime: string;
  location: string;
  appointmentId?: string;
  rescheduleUrl?: string;
  cancelUrl?: string;
}

export interface PrescriptionTemplateData extends EmailTemplateData {
  doctorName: string;
  prescriptionId: string;
  medications: readonly string[];
  pickupInstructions?: string;
  pharmacyName?: string;
  pharmacyAddress?: string;
}

export interface PaymentTemplateData extends EmailTemplateData {
  amount: number;
  currency: string;
  transactionId: string;
  paymentDate: string;
  serviceDescription: string;
  receiptUrl?: string;
}

export interface PasswordResetTemplateData extends EmailTemplateData {
  resetUrl: string;
  expiryTime?: string;
}

export interface AccountVerificationTemplateData extends EmailTemplateData {
  verificationUrl: string;
  verificationCode: string;
}

/**
 * Communication Provider Type
 */
export enum CommunicationProviderType {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  SMS = 'sms',
}

/**
 * Email Provider
 */
export enum EmailProvider {
  SMTP = 'smtp',
  AWS_SES = 'aws_ses',
  MAILGUN = 'mailgun',
  MAILTRAP = 'mailtrap',
  ZEPTOMAIL = 'zeptomail',
}

/**
 * WhatsApp Provider
 */
export enum WhatsAppProvider {
  META_BUSINESS = 'meta_business',
  TWILIO = 'twilio',
  MESSAGEBIRD = 'messagebird',
  VONAGE = 'vonage',
}

/**
 * SMS Provider
 */
export enum SMSProvider {
  TWILIO = 'twilio',
  AWS_SNS = 'aws_sns',
  MESSAGEBIRD = 'messagebird',
  VONAGE = 'vonage',
}

/**
 * Provider Configuration
 */
export interface ProviderConfig {
  provider: EmailProvider | WhatsAppProvider | SMSProvider;
  enabled: boolean;
  credentials: Record<string, string> | { encrypted: string };
  settings?: Record<string, unknown>;
  priority?: number;
}

/**
 * Clinic Communication Configuration
 */
export interface ClinicCommunicationConfig {
  clinicId: string;
  email: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultFrom?: string;
    defaultFromName?: string;
  };
  whatsapp: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultNumber?: string;
  };
  sms: {
    primary?: ProviderConfig;
    fallback?: ProviderConfig[];
    defaultNumber?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
