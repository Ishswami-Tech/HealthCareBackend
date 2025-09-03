// Centralized queue name management for robustness and consistency
export const APPOINTMENT_QUEUE = 'appointment-queue';
export const EMAIL_QUEUE = 'email-queue';
export const NOTIFICATION_QUEUE = 'notification-queue';
export const SERVICE_QUEUE = 'service-queue';
export const VIDHAKARMA_QUEUE = 'vidhakarma-queue';
export const PANCHAKARMA_QUEUE = 'panchakarma-queue';
export const CHEQUP_QUEUE = 'chequp-queue';

// Healthcare-specific queue configurations
export const HEALTHCARE_QUEUE_CONFIG = {
  // Default options for healthcare queues
  defaultJobOptions: {
    removeOnComplete: 10, // Keep last 10 completed jobs
    removeOnFail: 50,     // Keep last 50 failed jobs for debugging
    attempts: 3,
    backoff: {
      type: 'exponential' as const,
      delay: 2000,
    },
  },
  
  // Critical job options for emergency healthcare operations
  criticalJobOptions: {
    removeOnComplete: 100, // Keep more completed critical jobs
    removeOnFail: 100,     // Keep more failed critical jobs
    attempts: 5,
    backoff: {
      type: 'exponential' as const,
      delay: 1000,
    },
  },
  
  // Queue-specific configurations
  queues: {
    [APPOINTMENT_QUEUE]: {
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 50,
        attempts: 3,
      }
    },
    [NOTIFICATION_QUEUE]: {
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 5,
      }
    },
    [EMAIL_QUEUE]: {
      defaultJobOptions: {
        removeOnComplete: 30,
        removeOnFail: 50,
        attempts: 4,
      }
    },
    [SERVICE_QUEUE]: {
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 30,
        attempts: 3,
      }
    }
  }
}; 