/**
 * QUEUE JOB TYPE DEFINITIONS
 * ==========================
 * Proper TypeScript types for all queue job data structures
 * Centralized in @core/types for consistency
 */

// Base job metadata
export interface JobMetadata {
  clinicId?: string;
  userId?: string;
  timestamp?: Date;
  priority?: number;
  [key: string]: unknown;
}

// Appointment-related job data
export interface AppointmentData {
  appointmentId: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  status?: string;
  scheduledTime?: Date;
  duration?: number;
  type?: string;
  notes?: string;
}

export interface AppointmentJobData {
  appointment?: AppointmentData;
  appointmentId?: string;
  action?: string;
  metadata?: JobMetadata;
}

// Payment-related job data
export interface PaymentData {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: string;
  gateway: string;
  transactionId?: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface PaymentDto {
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentJobData {
  payment?: PaymentData;
  paymentDto?: PaymentDto;
  domain?: string;
  timestamp?: Date;
  fraudScore?: number;
  status?: string;
}

// Notification-related job data
export interface NotificationData {
  type: string;
  recipient: string;
  recipientId?: string;
  subject?: string;
  message: string;
  channel: 'email' | 'sms' | 'push' | 'whatsapp';
  templateId?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationJobData {
  notification?: NotificationData;
  type?: string;
  recipients?: string[];
  data?: Record<string, unknown>;
  metadata?: JobMetadata;
}

// Email-related job data
export interface EmailJobData {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
  metadata?: JobMetadata;
}

// Patient check-in job data
export interface PatientCheckinData {
  patientId: string;
  appointmentId?: string;
  clinicId: string;
  locationId?: string;
  checkinTime: Date;
  metadata?: JobMetadata;
}

// Analytics job data
export interface AnalyticsJobData {
  payment?: PaymentData;
  error?: Error;
  paymentDto?: PaymentDto;
  timestamp?: Date;
  eventType: string;
  eventData: Record<string, unknown>;
  metadata?: JobMetadata;
}

// Reconciliation job data
export interface ReconciliationJobData {
  paymentIds: string[];
  reconciliationType: 'daily' | 'weekly' | 'monthly';
  startDate?: Date;
  endDate?: Date;
  metadata?: JobMetadata;
}

// Generic queue job data with domain
export interface QueueJobData<T = unknown> {
  domain: 'clinic';
  action: string;
  data: T;
  metadata?: JobMetadata;
}

// Union type for all job data types
export type AnyJobData =
  | AppointmentJobData
  | PaymentJobData
  | NotificationJobData
  | EmailJobData
  | PatientCheckinData
  | AnalyticsJobData
  | ReconciliationJobData;

// Job processing result
export interface JobProcessingResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

// Worker status
export interface WorkerStatus {
  isRunning: boolean;
  queueName: string;
  concurrency: number;
}

// Queue metrics (basic - simple structure)
export interface QueueMetrics {
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  delayedJobs: number;
  waitingJobs: number;
}

// Queue metrics (detailed - used in QueueService)
export interface DetailedQueueMetrics {
  queueName: string;
  domain: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  throughputPerMinute: number;
  averageProcessingTime: number;
  errorRate: number;
}

// Queue health status
export interface QueueHealthStatus {
  isHealthy: boolean;
  domain: string;
  queues: DetailedQueueMetrics[];
  totalJobs: number;
  errorRate: number;
  averageResponseTime: number;
}

// Extended queue metrics (for monitoring service)
export interface ExtendedQueueMetrics {
  queueName: string;
  domain: string;
  totalJobs: number;
  waitingJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  delayedJobs: number;
  pausedJobs: number;
  processedJobs: number;
  throughput: number; // jobs per minute
  averageProcessingTime: number; // milliseconds
  errorRate: number; // percentage
  lastActivity: Date;
  health: 'healthy' | 'degraded' | 'unhealthy';
}

// Queue alert
export interface QueueAlert {
  id: string;
  queueName: string;
  type:
    | 'error_rate_high'
    | 'throughput_low'
    | 'queue_size_large'
    | 'processing_time_high'
    | 'health_degraded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

// Queue performance report
export interface QueuePerformanceReport {
  period: string;
  startDate: Date;
  endDate: Date;
  queues: ExtendedQueueMetrics[];
  summary: {
    totalQueues: number;
    healthyQueues: number;
    degradedQueues: number;
    unhealthyQueues: number;
    totalJobs: number;
    totalThroughput: number;
    averageErrorRate: number;
  };
  alerts: QueueAlert[];
  recommendations: string[];
}

// Performance metrics (queue-specific, distinct from general PerformanceMetrics)
export interface QueuePerformanceMetrics {
  throughput: number;
  averageLatency: number;
  errorRate: number;
  queueSize: number;
  activeConnections: number;
}

// Legacy alias for backwards compatibility during migration

// Fraud data
export interface FraudData {
  riskFactors: string[];
  userId: string;
  amount: number;
  gateway: string;
}

// ============================================================================
// Queue Service Types (used in QueueService)
// ============================================================================

/**
 * Generic job data interface
 * @interface JobData
 */
export interface JobData {
  [key: string]: unknown;
}

/**
 * Queue filter options
 * @interface QueueFilters
 */
export interface QueueFilters {
  status?: string[];
  priority?: string[];
  tenantId?: string;
  domain?: 'clinic' | 'worker';
  dateRange?: {
    from: string;
    to: string;
  };
}

/**
 * Client session for queue WebSocket connections
 * @interface ClientSession
 */
export interface ClientSession {
  clientId: string;
  tenantId: string;
  userId: string;
  domain: 'clinic' | 'worker';
  connectedAt: Date;
  subscribedQueues: Set<string>;
  messageCount: number;
  lastActivity: Date;
}

/**
 * Enterprise job options for queue operations
 * @interface EnterpriseJobOptions
 */
export interface EnterpriseJobOptions {
  tenantId?: string;
  correlationId?: string;
  priority?: number;
  classification?: 'public' | 'internal' | 'confidential' | 'restricted';
  auditLevel?: 'none' | 'basic' | 'detailed' | 'comprehensive';
  timeout?: number;
  delay?: number;
  attempts?: number;
  removeOnComplete?: boolean | number;
  removeOnFail?: boolean | number;
  domain?: 'clinic' | 'worker';
}

/**
 * Bulk job data for batch operations
 * @interface BulkJobData
 */
export interface BulkJobData<T = unknown> {
  jobType: string;
  data: T;
  options?: EnterpriseJobOptions;
}

/**
 * Audit actions for queue operations
 * @enum AuditAction
 */
export enum AuditAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
}

/**
 * Comprehensive queue health status (used by QueueHealthMonitorService)
 * Provides detailed health information including connection, metrics, queue status, etc.
 */
export interface QueueHealthMonitorStatus {
  healthy: boolean;
  connection: {
    connected: boolean;
    latency?: number;
    provider?: string;
  };
  metrics: {
    totalJobs: number;
    activeJobs: number;
    waitingJobs: number;
    failedJobs: number;
    completedJobs: number;
    errorRate: number;
  };
  performance: {
    averageProcessingTime: number;
    throughputPerMinute: number;
  };
  queues: Array<{
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }>;
  issues: string[];
}
