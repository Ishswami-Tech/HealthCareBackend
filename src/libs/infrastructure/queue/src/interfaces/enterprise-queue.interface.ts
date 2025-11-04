import { Job } from 'bullmq';

/**
 * Enterprise Queue Service Interface
 * Defines the contract for hyperscale, multi-tenant queue operations
 */
export interface IEnterpriseQueueService {
  // Core job management
  addJob<T = unknown>(
    queueName: string,
    jobType: string,
    data: T,
    options?: EnterpriseJobOptions
  ): Promise<EnterpriseJob<T>>;

  addBulkJobs<T = unknown>(queueName: string, jobs: BulkJobData<T>[]): Promise<EnterpriseJob<T>[]>;

  getJob<T = unknown>(jobId: string, queueName?: string): Promise<EnterpriseJob<T> | null>;
  removeJob(jobId: string, queueName?: string): Promise<boolean>;

  // Enterprise workflow operations
  startSaga<T = unknown>(
    sagaName: string,
    initialData: T,
    options?: SagaOptions
  ): Promise<SagaExecution<T>>;

  compensateSaga(sagaId: string, reason?: string): Promise<CompensationResult>;

  // Multi-tenant operations
  addTenantJob<T = unknown>(
    tenantId: string,
    queueName: string,
    jobType: string,
    data: T,
    options?: TenantJobOptions
  ): Promise<EnterpriseJob<T>>;

  getTenantJobs(tenantId: string, options?: TenantQueryOptions): Promise<EnterpriseJob[]>;

  // Monitoring and observability
  getQueueMetrics(queueName: string): Promise<EnterpriseQueueMetrics>;
  getQueueHealth(queueName: string): Promise<QueueHealthStatus>;
  getAllQueueStatuses(): Promise<Record<string, QueueStatus>>;

  // Compliance and audit
  getAuditTrail(jobId: string): Promise<AuditEvent[]>;
  exportComplianceReport(options: ComplianceExportOptions): Promise<ComplianceReport>;

  // Performance and scaling
  scaleQueue(queueName: string, targetConcurrency: number): Promise<ScalingResult>;
  enableAutoScaling(queueName: string, policy: AutoScalingPolicy): Promise<void>;

  // Multi-region operations
  replicateToRegion(jobId: string, targetRegion: string): Promise<ReplicationResult>;
  failoverToRegion(queueName: string, targetRegion: string): Promise<FailoverResult>;
}

/**
 * Enterprise Job with enhanced metadata and security
 */
export interface EnterpriseJob<T = unknown> extends Omit<Job<T>, 'data'> {
  // Enhanced identification
  id: string;
  tenantId: string;
  correlationId: string;
  parentJobId?: string;
  sagaId?: string;

  // Security and compliance
  data: EncryptedPayload<T>;
  classification: DataClassification;
  consentTokens: ConsentToken[];

  // Workflow and dependencies
  dependencies: JobDependency[];
  workflow?: WorkflowMetadata;

  // Observability
  traceId: string;
  spanId: string;
  metrics: JobMetrics;

  // Audit and compliance
  auditTrail: AuditEvent[];
  retentionPolicy: RetentionPolicy;

  // Multi-region
  region: string;
  replicationStatus?: ReplicationStatus;
}

/**
 * Enhanced job options for enterprise features
 */
export interface EnterpriseJobOptions {
  // Basic options
  delay?: number;
  priority?: JobPriority;
  attempts?: number;
  backoff?: BackoffStrategy;

  // Enterprise features
  tenantId?: string;
  correlationId?: string;
  classification?: DataClassification;
  consentTokens?: ConsentToken[];

  // Workflow options
  sagaId?: string;
  dependencies?: JobDependency[];
  timeout?: number;

  // Compliance options
  retentionPolicy?: RetentionPolicy;
  auditLevel?: AuditLevel;

  // Performance options
  batchable?: boolean;
  preferredRegion?: string;

  // Security options
  encryptionKey?: string;
  signatureRequired?: boolean;
}

/**
 * Multi-tenant job options
 */
export interface TenantJobOptions extends EnterpriseJobOptions {
  tenantId: string;
  quota?: TenantQuota;
  isolation?: IsolationLevel;
}

/**
 * Bulk job data structure
 */
export interface BulkJobData<T = unknown> {
  jobType: string;
  data: T;
  options?: EnterpriseJobOptions;
}

/**
 * Saga execution context
 */
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

/**
 * Saga configuration options
 */
export interface SagaOptions {
  timeout?: number;
  retryPolicy?: RetryPolicy;
  compensationTimeout?: number;
  auditLevel?: AuditLevel;
  tenantId?: string;
}

/**
 * Job dependency definition
 */
export interface JobDependency {
  jobId: string;
  relationship: DependencyRelationship;
  condition?: DependencyCondition;
}

/**
 * Workflow metadata
 */
export interface WorkflowMetadata {
  workflowId: string;
  workflowName: string;
  version: string;
  stepName: string;
  stepIndex: number;
  totalSteps: number;
}

/**
 * Enhanced queue metrics
 */
export interface EnterpriseQueueMetrics {
  // Basic metrics
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;

  // Performance metrics
  throughput: ThroughputMetrics;
  latency: LatencyMetrics;
  errorRates: ErrorRateMetrics;

  // Resource metrics
  memory: MemoryMetrics;
  cpu: CpuMetrics;
  network: NetworkMetrics;

  // Business metrics
  tenantMetrics: Record<string, TenantMetrics>;
  regionMetrics: Record<string, RegionMetrics>;

  // Compliance metrics
  auditMetrics: AuditMetrics;
  dataClassificationMetrics: DataClassificationMetrics;
}

/**
 * Encrypted payload structure
 */
export interface EncryptedPayload<T = unknown> {
  encrypted: string;
  keyId: string;
  algorithm: EncryptionAlgorithm;
  iv: string;
  tag: string;
  metadata: EncryptionMetadata;

  // For development/testing only
  _plaintext?: T;
}

/**
 * Audit event structure
 */
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

/**
 * Compliance report structure
 */
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

// Enums and types
export enum JobPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 5,
  LOW = 10,
  BACKGROUND = 15,
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

export enum AuditAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  EXECUTE = 'execute',
  COMPENSATE = 'compensate',
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

// Supporting interfaces
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

export interface QueueHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  lastChecked: Date;
  issues: HealthIssue[];
  metrics: Record<string, unknown>;
  recommendations: string[];
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
  duration?: string; // ISO 8601 duration
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
  workers: WorkerStatus[];
  lastActivity: Date;
}

export interface WorkerStatus {
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
