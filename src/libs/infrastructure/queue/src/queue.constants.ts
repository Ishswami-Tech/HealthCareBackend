// Centralized queue name management for robustness and consistency
export const APPOINTMENT_QUEUE = 'appointment-queue';
export const EMAIL_QUEUE = 'email-queue';
export const NOTIFICATION_QUEUE = 'notification-queue';
export const SERVICE_QUEUE = 'service-queue';
export const VIDHAKARMA_QUEUE = 'vidhakarma-queue';
export const PANCHAKARMA_QUEUE = 'panchakarma-queue';
export const CHEQUP_QUEUE = 'chequp-queue';

// Enhanced appointment management queues
export const ENHANCED_APPOINTMENT_QUEUE = 'enhanced-appointment-queue';
export const DOCTOR_AVAILABILITY_QUEUE = 'doctor-availability-queue';
export const QUEUE_MANAGEMENT_QUEUE = 'queue-management-queue';
export const WAITING_LIST_QUEUE = 'waiting-list-queue';
export const PAYMENT_PROCESSING_QUEUE = 'payment-processing-queue';
export const CALENDAR_SYNC_QUEUE = 'calendar-sync-queue';
export const AYURVEDA_THERAPY_QUEUE = 'ayurveda-therapy-queue';
export const PATIENT_PREFERENCE_QUEUE = 'patient-preference-queue';
export const ANALYTICS_QUEUE = 'analytics-queue';
export const REMINDER_QUEUE = 'reminder-queue';
export const FOLLOW_UP_QUEUE = 'follow-up-queue';
export const RECURRING_APPOINTMENT_QUEUE = 'recurring-appointment-queue';

// Removed unused fashion-specific queues - healthcare application only uses general queues

// Additional queue constants for enterprise queue service
export const PAYMENT_QUEUE = 'payment-queue';
export const EMERGENCY_QUEUE = 'emergency-queue';
export const VIP_QUEUE = 'vip-queue';

// Queue priorities and configuration
export const QUEUE_PRIORITIES = {
  CRITICAL: 10,
  HIGH: 7,
  NORMAL: 5,
  LOW: 3,
  BACKGROUND: 1,
} as const;

export const QUEUE_DELAYS = {
  IMMEDIATE: 0,
  SHORT: 5000, // 5 seconds
  MEDIUM: 30000, // 30 seconds
  LONG: 300000, // 5 minutes
  SCHEDULED: 0, // Use specific timestamp
} as const;

// Healthcare queue configuration
export const HEALTHCARE_QUEUE_CONFIG = {
  maxRetries: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 50,
  attempts: 3,
} as const;
