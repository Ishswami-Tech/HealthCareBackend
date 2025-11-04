/**
 * ===================================================================
 * A++ ENTERPRISE EVENT SYSTEM FOR 1M+ USERS
 * Healthcare-focused Event-Driven Architecture
 * ===================================================================
 */

export enum EventPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
  EMERGENCY = 'EMERGENCY',
}

export enum EventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  RETRYING = 'RETRYING',
  CANCELLED = 'CANCELLED',
}

export enum EventCategory {
  // Healthcare Business Events
  APPOINTMENT = 'APPOINTMENT',
  PATIENT = 'PATIENT',
  DOCTOR = 'DOCTOR',
  MEDICAL_RECORD = 'MEDICAL_RECORD',
  PRESCRIPTION = 'PRESCRIPTION',
  DIAGNOSIS = 'DIAGNOSIS',
  TREATMENT = 'TREATMENT',
  BILLING = 'BILLING',

  // System Events
  SYSTEM = 'SYSTEM',
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  AUDIT = 'AUDIT',
  SECURITY = 'SECURITY',

  // Infrastructure Events
  DATABASE = 'DATABASE',
  CACHE = 'CACHE',
  QUEUE = 'QUEUE',
  STORAGE = 'STORAGE',
  NETWORK = 'NETWORK',

  // Communication Events
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  NOTIFICATION = 'NOTIFICATION',
  WEBSOCKET = 'WEBSOCKET',

  // Integration Events
  WEBHOOK = 'WEBHOOK',
  API = 'API',
  EXTERNAL_SERVICE = 'EXTERNAL_SERVICE',

  // Compliance Events
  HIPAA = 'HIPAA',
  GDPR = 'GDPR',
  AUDIT_TRAIL = 'AUDIT_TRAIL',

  // Performance Events
  PERFORMANCE = 'PERFORMANCE',
  MONITORING = 'MONITORING',
  SCALING = 'SCALING',
  HEALTH_CHECK = 'HEALTH_CHECK',
}

export interface BaseEventPayload {
  eventId: string;
  eventType: string;
  category: EventCategory;
  priority: EventPriority;
  timestamp: string;
  source: string;
  version: string;
  correlationId?: string;
  causationId?: string;
  userId?: string;
  clinicId?: string;
  organizationId?: string;
  sessionId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface EnterpriseEventPayload extends BaseEventPayload {
  // Enterprise features
  tenantId?: string;
  businessUnit?: string;
  geolocation?: {
    country: string;
    region: string;
    city: string;
  };

  // Performance tracking
  performanceMetrics?: {
    executionTime?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    networkLatency?: number;
  };

  // Retry mechanism
  retryAttempt?: number;
  maxRetries?: number;
  retryDelay?: number;

  // Scheduling
  scheduledFor?: string;
  expiresAt?: string;

  // Error handling
  errorInfo?: {
    message: string;
    code: string;
    stack?: string;
    context?: Record<string, unknown>;
  };

  // Compliance
  complianceInfo?: {
    requiresAudit: boolean;
    dataClassification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'PHI';
    retentionPeriod: number;
    encryptionRequired: boolean;
  };
}

// Healthcare-specific event payloads
export interface AppointmentEvent extends EnterpriseEventPayload {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  appointmentDate: string;
  appointmentTime: string;
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  appointmentType: string;
  duration: number;
  notes?: string;
}

export interface PatientEvent extends EnterpriseEventPayload {
  patientId: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED' | 'ARCHIVED' | 'MERGED';
  patientData?: {
    name: string;
    age: number;
    gender: string;
    contactInfo: Record<string, unknown>;
    medicalHistory?: string[];
    allergies?: string[];
    emergencyContact?: Record<string, unknown>;
  };
  consentStatus?: 'GRANTED' | 'DENIED' | 'WITHDRAWN' | 'EXPIRED';
}

export interface MedicalRecordEvent extends EnterpriseEventPayload {
  recordId: string;
  patientId: string;
  providerId: string;
  recordType: 'CLINICAL_NOTE' | 'LAB_RESULT' | 'IMAGING' | 'PRESCRIPTION' | 'PROCEDURE';
  action: 'CREATED' | 'UPDATED' | 'ACCESSED' | 'SHARED' | 'DELETED';
  phi: boolean;
  accessReason: 'TREATMENT' | 'PAYMENT' | 'OPERATIONS' | 'RESEARCH' | 'LEGAL';
}

export interface SecurityEvent extends EnterpriseEventPayload {
  securityEventType:
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILURE'
    | 'LOGOUT'
    | 'PASSWORD_CHANGE'
    | 'ACCOUNT_LOCKED'
    | 'SUSPICIOUS_ACTIVITY'
    | 'UNAUTHORIZED_ACCESS'
    | 'DATA_BREACH';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  ipAddress: string;
  userAgent: string;
  deviceFingerprint?: string;
  geoLocation?: {
    country: string;
    region: string;
    city: string;
    latitude: number;
    longitude: number;
  };
}

export interface SystemEvent extends EnterpriseEventPayload {
  systemComponent: string;
  action: 'START' | 'STOP' | 'RESTART' | 'DEPLOY' | 'SCALE' | 'BACKUP' | 'MAINTENANCE';
  resourceMetrics?: {
    cpu: number;
    memory: number;
    disk: number;
    network: number;
  };
  serviceHealth?: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'CRITICAL';
}

export interface EventResult<T = unknown> {
  success: boolean;
  eventId: string;
  result?: T;
  error?: {
    code: string;
    message: string;
    stack?: string;
    retryable: boolean;
  };
  processingTime: number;
  timestamp: string;
}

export interface EventFilter {
  category?: EventCategory[];
  priority?: EventPriority[];
  status?: EventStatus[];
  startTime?: string;
  endTime?: string;
  userId?: string;
  clinicId?: string;
  source?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export interface EventMetrics {
  totalEvents: number;
  eventsPerSecond: number;
  avgProcessingTime: number;
  eventsByCategory: Record<EventCategory, number>;
  eventsByPriority: Record<EventPriority, number>;
  eventsByStatus: Record<EventStatus, number>;
  failureRate: number;
  retryRate: number;
  errorDistribution: Record<string, number>;
}

export interface EventSubscription {
  id: string;
  eventType: string | string[];
  category?: EventCategory[];
  priority?: EventPriority[];
  filter?: (event: EnterpriseEventPayload) => boolean;
  handler: (event: EnterpriseEventPayload) => Promise<void> | void;
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
  deadLetterQueue?: string;
  created: Date;
  lastTriggered?: Date;
  triggerCount: number;
  active: boolean;
}

// Event handler decorator metadata
export interface EventHandlerMetadata {
  eventType: string;
  category: EventCategory;
  priority: EventPriority;
  async: boolean;
  retry: boolean;
  deadLetterQueue?: string;
  timeout?: number;
}
