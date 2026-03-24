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

// ============================================================================
// Queue Unification Types (New)
// ============================================================================

export enum JobType {
  APPOINTMENT = 'appointment',
  EMAIL = 'email',
  NOTIFICATION = 'notification',
  SERVICE = 'service',
  VIDHAKARMA = 'vidhakarma',
  PANCHAKARMA = 'panchakarma',
  CHEQUP = 'chequp',
  DOCTOR_AVAILABILITY = 'doctor_availability',
  QUEUE_MANAGEMENT = 'queue_management',
  PAYMENT_PROCESSING = 'payment_processing',
  ANALYTICS = 'analytics',
  ENHANCED_APPOINTMENT = 'enhanced_appointment',
  WAITING_LIST = 'waiting_list',
  CALENDAR_SYNC = 'calendar_sync',
  AYURVEDA_THERAPY = 'ayurveda_therapy',
  PATIENT_PREFERENCE = 'patient_preference',
  REMINDER = 'reminder',
  FOLLOW_UP = 'follow_up',
  RECURRING_APPOINTMENT = 'recurring_appointment',
  EMERGENCY = 'emergency',
  VIP = 'vip',
  LAB_REPORT = 'lab_report',
  IMAGING = 'imaging',
  BULK_EHR_IMPORT = 'bulk_ehr_import',
  INVOICE_PDF = 'invoice_pdf',
  BULK_INVOICE = 'bulk_invoice',
  PAYMENT_RECONCILIATION = 'payment_reconciliation',
  PAYMENT_ANALYTICS = 'payment_analytics',
  PAYMENT_NOTIFICATION = 'payment_notification',
  VIDEO_RECORDING = 'video_recording',
  VIDEO_TRANSCODING = 'video_transcoding',
  VIDEO_ANALYTICS = 'video_analytics',
  // Standard lifecycle job types
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  CONFIRM = 'confirm',
  COMPLETE = 'complete',
  NOTIFY = 'notify',
  // Represents old generic/fallback actions
  UNKNOWN = 'unknown',
}

export enum JobPriorityLevel {
  CRITICAL = 10,
  HIGH = 7,
  NORMAL = 5,
  LOW = 3,
  BACKGROUND = 1,
}

// The unified Canonical Job Envelope payload structure
export interface CanonicalJobEnvelope<T = unknown> {
  // Routing layer
  jobType: JobType;
  priority: JobPriorityLevel;
  domain: 'clinic';
  clinicId?: string;
  tenantId?: string;

  // Context layer
  context?: {
    locationId?: string;
    doctorId?: string;
    patientId?: string;
    laneType?: string; // Optional lane specific queueCategory
    appointmentId?: string;
  };

  // Payload layer
  action: string;
  data: T;
  metadata?: JobMetadata;
}

// Generic queue job data with domain (Deprecated - map to CanonicalJobEnvelope)
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
  errorCount?: number;
  lastError?: Date;
  lastErrorMessage?: string;
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
  userId?: string;
  clinicId?: string;
  importId?: string;
  records?: unknown[];
  importData?: unknown[];
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
  domain?: 'clinic';
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
  domain: 'clinic';
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
  domain?: 'clinic';
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

// --- Merged from enterprise-queue.interface.ts ---
import { Job } from 'bullmq';

export interface EnterpriseJob<T = unknown> extends Omit<Job<T>, 'data'> {
  id: string;
  tenantId: string;
  correlationId: string;
  parentJobId?: string;
  sagaId?: string;
  data: EncryptedPayload<T>;
  classification: DataClassification;
  consentTokens: ConsentToken[];
  dependencies: JobDependency[];
  workflow?: WorkflowMetadata;
  traceId: string;
  spanId: string;
  metrics: JobMetrics;
  auditTrail: AuditEvent[];
  retentionPolicy: RetentionPolicy;
  region: string;
  replicationStatus?: ReplicationStatus;
}

export interface TenantJobOptions extends EnterpriseJobOptions {
  tenantId: string;
  quota?: TenantQuota;
  isolation?: IsolationLevel;
}

export interface SagaExecution<T = unknown> {
  sagaId: string;
  sagaName: string;
  status: SagaStatus;
  currentStep: number;
  totalSteps: number;
  data: T;
  compensationData: unknown[];
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: SagaError;
}

export interface SagaOptions {
  timeout?: number;
  retryPolicy?: RetryPolicy;
  compensationTimeout?: number;
  auditLevel?: AuditLevel;
  tenantId?: string;
}

export interface JobDependency {
  jobId: string;
  relationship: DependencyRelationship;
  condition?: DependencyCondition;
}

export interface WorkflowMetadata {
  workflowId: string;
  workflowName: string;
  version: string;
  stepName: string;
  stepIndex: number;
  totalSteps: number;
}

export interface EnterpriseQueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  throughput: ThroughputMetrics;
  latency: LatencyMetrics;
  errorRates: ErrorRateMetrics;
  memory: MemoryMetrics;
  cpu: CpuMetrics;
  network: NetworkMetrics;
  tenantMetrics: Record<string, TenantMetrics>;
  regionMetrics: Record<string, RegionMetrics>;
  auditMetrics: AuditMetrics;
  dataClassificationMetrics: DataClassificationMetrics;
}

export interface EncryptedPayload<T = unknown> {
  encrypted: string;
  keyId: string;
  algorithm: EncryptionAlgorithm;
  iv: string;
  tag: string;
  metadata: EncryptionMetadata;
  _plaintext?: T;
}

export interface AuditEvent {
  eventId: string;
  timestamp: Date;
  tenantId: string;
  userId?: string;
  action: AuditAction;
  resource: string;
  resourceId: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  signature: string;
}

export interface ComplianceReport {
  reportId: string;
  generatedAt: Date;
  reportType: ComplianceReportType;
  period: DateRange;
  tenantId?: string;
  summary: ComplianceSummary;
  violations: ComplianceViolation[];
  recommendations: ComplianceRecommendation[];
  evidence: ComplianceEvidence[];
  signature: string;
  certification: ComplianceCertification;
}

export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted',
  PHI = 'phi',
  PII = 'pii',
}

export enum SagaStatus {
  STARTED = 'started',
  RUNNING = 'running',
  COMPENSATING = 'compensating',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum DependencyRelationship {
  REQUIRES = 'requires',
  BLOCKS = 'blocks',
  FOLLOWS = 'follows',
  PARALLEL = 'parallel',
}

export enum AuditLevel {
  NONE = 'none',
  BASIC = 'basic',
  DETAILED = 'detailed',
  COMPREHENSIVE = 'comprehensive',
}

export enum EncryptionAlgorithm {
  AES_256_GCM = 'aes-256-gcm',
  CHACHA20_POLY1305 = 'chacha20-poly1305',
}

export enum ComplianceReportType {
  HIPAA = 'hipaa',
  GDPR = 'gdpr',
  SOC2 = 'soc2',
  PCI_DSS = 'pci-dss',
}

export enum IsolationLevel {
  SHARED = 'shared',
  LOGICAL = 'logical',
  PHYSICAL = 'physical',
}

export interface ThroughputMetrics {
  jobsPerSecond: number;
  jobsPerMinute: number;
  jobsPerHour: number;
  peakThroughput: number;
  averageThroughput: number;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  average: number;
  maximum: number;
}

export interface ErrorRateMetrics {
  overall: number;
  byJobType: Record<string, number>;
  byTenant: Record<string, number>;
  byRegion: Record<string, number>;
}

export interface MemoryMetrics {
  used: number;
  available: number;
  peak: number;
  gcFrequency: number;
}

export interface CpuMetrics {
  utilization: number;
  loadAverage: number[];
  processes: number;
  threads: number;
}

export interface NetworkMetrics {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  errors: number;
}

export interface TenantMetrics {
  tenantId: string;
  jobsProcessed: number;
  averageLatency: number;
  errorRate: number;
  quotaUtilization: number;
}

export interface RegionMetrics {
  region: string;
  jobsProcessed: number;
  averageLatency: number;
  failoverCount: number;
  replicationLag: number;
}

export interface HealthIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  code: string;
  affectedResources: string[];
  mitigationSteps: string[];
}

export interface ConsentToken {
  purpose: string;
  granted: boolean;
  grantedAt?: Date;
  expiresAt?: Date;
  restrictions?: string[];
}

export interface RetentionPolicy {
  type: 'time-based' | 'event-based' | 'consent-based';
  duration?: string;
  condition?: string;
  actions: RetentionAction[];
}

export interface RetentionAction {
  action: 'archive' | 'delete' | 'anonymize' | 'encrypt';
  delay?: string;
  configuration?: Record<string, unknown>;
}

export interface AutoScalingPolicy {
  enabled: boolean;
  metrics: ScalingMetric[];
  rules: ScalingRule[];
  cooldown: number;
  limits: ScalingLimits;
}

export interface ScalingMetric {
  name: string;
  threshold: number;
  comparison: 'greater' | 'less' | 'equal';
  duration: number;
}

export interface ScalingRule {
  condition: string;
  action: ScalingAction;
  cooldown?: number;
}

export interface ScalingAction {
  type: 'scale-up' | 'scale-down' | 'alert';
  factor?: number;
  target?: number;
}

export interface ScalingLimits {
  minWorkers: number;
  maxWorkers: number;
  maxScaleUpStep: number;
  maxScaleDownStep: number;
}

export interface TenantQuota {
  maxJobsPerSecond: number;
  maxJobsPerHour: number;
  maxJobsPerDay: number;
  maxConcurrentJobs: number;
  maxJobSize: number;
  maxRetentionPeriod: string;
}

export interface BackoffStrategy {
  type: 'exponential' | 'linear' | 'fixed';
  delay: number;
  maxDelay?: number;
  factor?: number;
  jitter?: boolean;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff: BackoffStrategy;
  retryOn?: string[];
  skipOn?: string[];
}

export interface DependencyCondition {
  type: 'status' | 'data' | 'time' | 'custom';
  value: unknown;
  operator?: 'equals' | 'not-equals' | 'greater' | 'less';
}

export interface SagaError {
  step: number;
  error: Error;
  compensationFailed?: boolean;
  retryCount: number;
}

export interface CompensationResult {
  sagaId: string;
  status: 'started' | 'completed' | 'failed';
  compensatedSteps: number[];
  failedCompensations: number[];
  errors: Error[];
}

export interface EncryptionMetadata {
  createdAt: Date;
  createdBy: string;
  version: number;
  additionalData?: Record<string, unknown>;
}

export interface JobMetrics {
  submittedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  attempts: number;
  memoryUsage?: number;
  cpuTime?: number;
}

export interface QueueStatus {
  name: string;
  status: 'active' | 'paused' | 'failed' | 'unknown';
  health: QueueHealthStatus;
  metrics: EnterpriseQueueMetrics;
  workers: EnterpriseWorkerStatus[];
  lastActivity: Date;
}

export interface EnterpriseWorkerStatus {
  id: string;
  status: 'idle' | 'busy' | 'failed';
  currentJob?: string;
  processed: number;
  failed: number;
  startedAt: Date;
  lastActivity: Date;
}

export interface ReplicationStatus {
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  targetRegions: string[];
  completedRegions: string[];
  failedRegions: string[];
  lastReplication: Date;
}

export interface ReplicationResult {
  jobId: string;
  targetRegion: string;
  status: 'success' | 'failed';
  replicationId: string;
  latency: number;
  error?: Error;
}

export interface FailoverResult {
  queueName: string;
  sourceRegion: string;
  targetRegion: string;
  status: 'success' | 'failed';
  duration: number;
  affectedJobs: number;
  error?: Error;
}

export interface ScalingResult {
  queueName: string;
  previousConcurrency: number;
  newConcurrency: number;
  status: 'success' | 'failed';
  duration: number;
  error?: Error;
}

export interface TenantQueryOptions {
  status?: string[];
  jobTypes?: string[];
  dateRange?: DateRange;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface ComplianceExportOptions {
  reportType: ComplianceReportType;
  period: DateRange;
  tenantId?: string;
  includeEvidence?: boolean;
  format?: 'json' | 'pdf' | 'csv';
}

export interface ComplianceSummary {
  totalEvents: number;
  violationCount: number;
  complianceScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastAssessment: Date;
}

export interface ComplianceViolation {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affectedResources: string[];
  detectedAt: Date;
  resolvedAt?: Date;
  evidence: string[];
}

export interface ComplianceRecommendation {
  id: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  implementation: string[];
  estimatedEffort: string;
  impact: string;
}

export interface ComplianceEvidence {
  id: string;
  type: string;
  description: string;
  dataLocation: string;
  hash: string;
  timestamp: Date;
  retentionUntil: Date;
}

export interface ComplianceCertification {
  certifiedBy: string;
  certificationDate: Date;
  validUntil: Date;
  standards: string[];
  auditor?: string;
  signature: string;
}

export interface AuditMetrics {
  totalEvents: number;
  eventsByAction: Record<string, number>;
  eventsByUser: Record<string, number>;
  eventsByResource: Record<string, number>;
  anomalousEvents: number;
  complianceScore: number;
}

export interface DataClassificationMetrics {
  totalJobs: number;
  jobsByClassification: Record<string, number>;
  encryptedJobs: number;
  anonymizedJobs: number;
  retentionCompliance: number;
}
