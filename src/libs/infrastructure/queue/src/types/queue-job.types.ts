/**
 * QUEUE JOB TYPE DEFINITIONS
 * ==========================
 * Proper TypeScript types for all queue job data structures
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

// Queue metrics
export interface QueueMetrics {
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  delayedJobs: number;
  waitingJobs: number;
}

// Performance metrics
export interface PerformanceMetrics {
  throughput: number;
  averageLatency: number;
  errorRate: number;
  queueSize: number;
  activeConnections: number;
}

// Fraud data
export interface FraudData {
  riskFactors: string[];
  userId: string;
  amount: number;
  gateway: string;
}
