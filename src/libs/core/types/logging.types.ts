/**
 * ===================================================================
 * ENTERPRISE-GRADE LOGGING TYPES FOR 1M+ USERS
 * A++ Grade Implementation with HIPAA Compliance
 * ===================================================================
 */

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE',
  TRACE = 'TRACE',
}

export enum LogType {
  // System & Infrastructure
  SYSTEM = 'SYSTEM',
  ERROR = 'ERROR',
  DATABASE = 'DATABASE',
  CACHE = 'CACHE',
  QUEUE = 'QUEUE',
  PERFORMANCE = 'PERFORMANCE',

  // Authentication & Security
  AUTH = 'AUTH',
  SECURITY = 'SECURITY',
  ACCESS_CONTROL = 'ACCESS_CONTROL',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',

  // Communication
  REQUEST = 'REQUEST',
  RESPONSE = 'RESPONSE',
  WEBSOCKET = 'WEBSOCKET',
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  NOTIFICATION = 'NOTIFICATION',

  // Business Operations
  AUDIT = 'AUDIT',
  APPOINTMENT = 'APPOINTMENT',
  BUSINESS = 'BUSINESS',
  PAYMENT = 'PAYMENT',
  USER_ACTIVITY = 'USER_ACTIVITY',

  // HIPAA Compliance - Enterprise Healthcare Features
  PHI_ACCESS = 'PHI_ACCESS',
  MEDICAL_RECORD_ACCESS = 'MEDICAL_RECORD_ACCESS',
  PATIENT_DATA_EXPORT = 'PATIENT_DATA_EXPORT',
  CONSENT_MANAGEMENT = 'CONSENT_MANAGEMENT',
  DATA_MINIMIZATION = 'DATA_MINIMIZATION',
  ENCRYPTION_EVENT = 'ENCRYPTION_EVENT',
  BREACH_NOTIFICATION = 'BREACH_NOTIFICATION',
  COMPLIANCE_VIOLATION = 'COMPLIANCE_VIOLATION',

  // Emergency & Critical Events
  EMERGENCY = 'EMERGENCY',
  CRITICAL_ALERT = 'CRITICAL_ALERT',
  INCIDENT = 'INCIDENT',

  // Multi-Tenant & Clinic Operations
  CLINIC_OPERATIONS = 'CLINIC_OPERATIONS',
  TENANT_ISOLATION = 'TENANT_ISOLATION',
  MULTI_CLINIC = 'MULTI_CLINIC',

  // Monitoring & Observability
  METRICS = 'METRICS',
  HEALTH_CHECK = 'HEALTH_CHECK',
  RESOURCE_USAGE = 'RESOURCE_USAGE',
  SCALING_EVENT = 'SCALING_EVENT',
}

/**
 * Log context for distributed tracing and correlation
 * @interface LogContext
 */
export interface LogContext {
  correlationId?: string;
  traceId?: string;
  userId?: string;
  operation?: string;
  clinicId?: string;
  domain?: 'clinic' | 'healthcare' | 'worker';
}

export interface LogEntry {
  id: string;
  type: LogType;
  level: LogLevel;
  message: string;
  context: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  correlationId?: string;
  traceId?: string;
  userId?: string;
  clinicId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  service?: string;
  version?: string;
  environment?: string;
}

export interface EnterpriseLogEntry extends LogEntry {
  // Enterprise features for 1M+ users
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  retentionPeriod: number; // in days
  complianceType?: 'HIPAA' | 'GDPR' | 'SOC2' | 'PCI_DSS';
  encrypted: boolean;
  auditTrail: boolean;
  alertRequired: boolean;

  // Performance tracking
  executionTime?: number;
  memoryUsage?: number;
  cpuUsage?: number;

  // Multi-tenant support
  tenantId?: string;
  organizationId?: string;
  locationId?: string;

  // Request context
  requestId?: string;
  operationId?: string;
  parentSpanId?: string;

  // Security context
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  sensitiveData: boolean;
  phiData: boolean;

  // Business context
  businessUnit?: string;
  department?: string;
  costCenter?: string;

  // Technical context
  stackTrace?: string;
  errorCode?: string;
  httpStatusCode?: number;
  responseSize?: number;

  // Compliance fields
  dataClassification?: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'PHI';
  purposeOfUse?: string;
  legalBasis?: string;
  dataRetentionPolicy?: string;
}

export interface HealthcareAuditLogEntry extends EnterpriseLogEntry {
  // HIPAA-specific fields for healthcare compliance
  patientId?: string;
  providerId?: string;
  encounterDate?: Date;
  diagnosticCode?: string;
  treatmentCode?: string;

  // PHI access tracking
  phiAccessType?: 'DIRECT' | 'INDIRECT' | 'ADMINISTRATIVE';
  phiDataTypes?: string[];
  accessPurpose?: 'TREATMENT' | 'PAYMENT' | 'OPERATIONS' | 'RESEARCH' | 'DISCLOSURE';

  // Consent tracking
  consentStatus?: 'GRANTED' | 'DENIED' | 'WITHDRAWN' | 'EXPIRED';
  consentDocument?: string;

  // Medical record context
  recordType?: 'CLINICAL' | 'ADMINISTRATIVE' | 'FINANCIAL' | 'RESEARCH';
  medicalSpecialty?: string;
  careTeamMember?: string;

  // Emergency access
  emergencyAccess?: boolean;
  emergencyJustification?: string;
  emergencyOverride?: boolean;

  // Minimum necessary determination
  dataMinimization?: boolean;
  minimumNecessary?: boolean;
  accessJustification?: string;

  // Breach investigation
  breachRisk?: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
  breachContainment?: string;
  breachNotification?: boolean;
}

/**
 * Logging Performance Metrics
 * @interface LoggingPerformanceMetrics
 * @description Logging-specific performance metrics (renamed to avoid conflicts)
 */
export interface LoggingPerformanceMetrics {
  timestamp: string;
  operation: string;
  duration: number;
  success: boolean;
  errorRate: number;
  throughput: number;
  concurrentUsers: number;
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  networkLatency: number;
  cacheHitRate: number;
  databaseResponseTime: number;
  queueLength: number;
  activeConnections: number;
}

export type { SecurityEvent } from './event.types';

export interface ComplianceEvent {
  timestamp: string;
  complianceFramework: 'HIPAA' | 'GDPR' | 'SOC2' | 'PCI_DSS' | 'HITECH';
  eventCategory: 'ACCESS' | 'PROCESSING' | 'STORAGE' | 'TRANSMISSION' | 'DISPOSAL';
  dataSubject?: string;
  dataController: string;
  dataProcessor?: string;
  legalBasis?: string;
  purposeOfProcessing: string;
  dataCategories: string[];
  retentionPeriod?: number;
  crossBorderTransfer?: boolean;
  thirdPartySharing?: boolean;
  consentObtained?: boolean;
  rightToErasure?: boolean;
  dataPortabilityRequest?: boolean;
  privacyImpactAssessment?: boolean;
  dataProtectionOfficer?: string;
  incidentReported?: boolean;
  regulatoryNotification?: boolean;
}

export interface AlertConfiguration {
  alertType: LogType;
  severity: LogLevel;
  threshold: number;
  timeWindow: number; // in seconds
  recipients: string[];
  escalationLevels: Array<{
    level: number;
    delayMinutes: number;
    recipients: string[];
    notificationChannels: string[];
  }>;
  suppressionRules?: Array<{
    condition: string;
    suppressionDuration: number;
  }>;
  customMessage?: string;
  includeContext: boolean;
  attachLogs: boolean;
  requireAcknowledgment: boolean;
}

export interface LogRetentionPolicy {
  logType: LogType;
  retentionDays: number;
  archiveAfterDays?: number;
  compressionEnabled: boolean;
  encryptionRequired: boolean;
  complianceRequirement?: string;
  deleteAfterDays?: number;
  backupRequired: boolean;
  auditLogRetention?: boolean;
}

export interface LogAnalytics {
  timeRange: {
    start: Date;
    end: Date;
  };
  totalEvents: number;
  eventsPerHour: number;
  errorRate: number;
  topErrorTypes: Array<{
    type: string;
    count: number;
    percentage: number;
  }>;
  performanceMetrics: {
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    slowestOperations: Array<{
      operation: string;
      avgTime: number;
      count: number;
    }>;
  };
  securityEvents: {
    totalSecurityEvents: number;
    failedLogins: number;
    suspiciousActivity: number;
    blockedRequests: number;
    riskDistribution: Record<string, number>;
  };
  complianceMetrics: {
    phiAccessEvents: number;
    auditEvents: number;
    consentEvents: number;
    breachRisk: number;
    complianceScore: number;
  };
  resourceUsage: {
    avgCpuUsage: number;
    avgMemoryUsage: number;
    peakConcurrentUsers: number;
    totalDatabaseQueries: number;
    cacheEfficiency: number;
  };
}

// Helper function to create standardized log data
// Uses helper functions (which use dotenv) for environment variable access
// These mimic ConfigService methods but work in utility functions
export function createLogData(
  type: LogType,
  level: LogLevel,
  message: string,
  context: string,
  metadata: Record<string, unknown> = {}
): LogEntry {
  // Import helper functions that use dotenv (already loaded)
  // Use dynamic import to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getEnvironment, getEnvWithDefault } = require('@config/environment/utils') as {
    getEnvironment: () => string;
    getEnvWithDefault: (key: string, defaultValue: string) => string;
  };

  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    type,
    level,
    message,
    context,
    metadata: {
      ...(metadata || {}),
      timestamp: new Date().toISOString(),
      environment: getEnvironment(),
      service: getEnvWithDefault('SERVICE_NAME', 'healthcare-backend'),
    },
    timestamp: new Date(),
  };
}

// Helper function for HIPAA audit logging
export function createHipaaAuditLog(
  userId: string,
  patientId: string,
  action: string,
  resource: string,
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
  additionalData: Partial<HealthcareAuditLogEntry> = {}
): HealthcareAuditLogEntry {
  return {
    ...createLogData(LogType.PHI_ACCESS, LogLevel.INFO, `PHI Access: ${action}`, 'HIPAA_Audit'),
    priority: 'HIGH',
    retentionPeriod: 2555, // 7 years for HIPAA
    complianceType: 'HIPAA',
    encrypted: true,
    auditTrail: true,
    alertRequired: outcome !== 'SUCCESS',
    sensitiveData: true,
    phiData: true,
    dataClassification: 'PHI',
    userId,
    patientId,
    accessPurpose: 'TREATMENT',
    phiAccessType: 'DIRECT',
    recordType: 'CLINICAL',
    dataMinimization: true,
    minimumNecessary: true,
    breachRisk: 'NONE',
    ...additionalData,
  } as HealthcareAuditLogEntry;
}

// Helper function for performance logging
export function createPerformanceLog(
  operation: string,
  duration: number,
  additionalMetrics: Partial<LoggingPerformanceMetrics> = {}
): EnterpriseLogEntry {
  return {
    ...createLogData(
      LogType.PERFORMANCE,
      LogLevel.INFO,
      `Performance: ${operation}`,
      'PerformanceMonitoring'
    ),
    priority: duration > 5000 ? 'HIGH' : 'NORMAL',
    retentionPeriod: 90,
    encrypted: false,
    auditTrail: false,
    alertRequired: duration > 10000,
    executionTime: duration,
    sensitiveData: false,
    phiData: false,
    ...additionalMetrics,
  } as EnterpriseLogEntry;
}

// Helper function for security event logging
export function createSecurityLog(
  eventType: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  details: Partial<import('./event.types').SecurityEvent>
): EnterpriseLogEntry {
  return {
    ...createLogData(
      LogType.SECURITY,
      severity === 'CRITICAL' ? LogLevel.ERROR : LogLevel.WARN,
      `Security: ${eventType}`,
      'SecurityMonitoring'
    ),
    priority: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    retentionPeriod: 365, // 1 year for security events
    complianceType: 'SOC2',
    encrypted: true,
    auditTrail: true,
    alertRequired: severity === 'HIGH' || severity === 'CRITICAL',
    riskLevel: severity,
    sensitiveData: true,
    phiData: false,
    ...details,
  } as EnterpriseLogEntry;
}

/**
 * Logging service interface type
 * Used for type-safe logging operations across the application
 */
export interface ILoggingService {
  log: (
    type: LogType,
    level: LogLevel,
    message: string,
    context: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>;
}

/**
 * Comprehensive logging health status (used by LoggingHealthMonitorService)
 * Provides detailed health information including service availability, endpoint accessibility, metrics, etc.
 */
export interface LoggingHealthMonitorStatus {
  healthy: boolean;
  service: {
    available: boolean;
    latency?: number;
    serviceName?: string;
  };
  endpoint: {
    accessible: boolean;
    latency?: number;
    url?: string;
    port?: number;
    statusCode?: number;
  };
  metrics: {
    totalLogs: number;
    errorRate: number;
    averageResponseTime: number;
  };
  performance: {
    throughput?: number;
    bufferSize?: number;
    flushInterval?: number;
  };
  issues: string[];
}
