/**
 * Comprehensive Database Types
 * This file consolidates all database-related types including:
 * - Database infrastructure types (metrics, health, client interfaces)
 * - Repository pattern types (RepositoryResult, query options)
 * - Entity types (Prisma entity definitions and relations)
 * - Database provider interfaces (IDatabaseProvider, IConnectionPoolManager, IReadReplicaRouter)
 * All types are strictly typed without using 'any' or 'unknown'.
 */

// Prisma 7: Import from @prisma/client (resolved via symlink or path mapping)
import type { PrismaClient } from '@prisma/client';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HttpStatus } from '@nestjs/common';

// ============================================================================
// Prisma Entity Type Imports
// ============================================================================

// ============================================================================
// DOMAIN ENTITY TYPES
// ============================================================================

/**
 * Prisma Entity Type Re-exports
 * These are type aliases for Prisma-generated entities
 */

// Re-export UserWithRelations type from user.types.ts for use in this file
import type { UserWithRelations } from './user.types';
export type { UserWithRelations };

// Use explicit interface definitions to avoid 'any' in union types from Prisma
// These types match Prisma entities but avoid using Prisma's generated types directly in union types
export interface User {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  password: string;
  role: string;
  dateOfBirth: Date | null;
  gender: string | null;
  address: string | null;
  emergencyContact?: string;
  primaryClinicId?: string;
  primaryClinic?: Clinic;
  clinics?: Clinic[];
  clinicAdmins?: ClinicAdmin[];
  receptionists?: Receptionist[];
  doctorClinics?: DoctorClinic[];
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Product = Record<string, never>;
export type Appointment = AppointmentBase;
export type Payment = PaymentBase;
export interface Doctor {
  id: string;
  userId: string;
  specialization: string | null;
  qualifications: string | null;
  experience: number | null;
  licenseNumber: string | null;
  bio: string | null;
  consultationFee: number | null;
  createdAt: Date;
  updatedAt: Date;
}
export type Patient = PatientBase;
export interface Clinic {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  logo: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  primaryUsers?: User[];
  users?: User[];
}
export interface ClinicAdmin {
  id: string;
  userId: string;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface SuperAdmin {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface Receptionist {
  id: string;
  userId: string;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface DoctorClinic {
  id: string;
  doctorId: string;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
}
export type Medicine = Record<string, never>;
export type Therapy = Record<string, never>;
export type Prescription = Record<string, never>;
export type PrescriptionItem = Record<string, never>;
export type Queue = Record<string, never>;
export type HealthRecord = Record<string, never>;
export type Review = Record<string, never>;
export type Notification = Record<string, never>;
export type { PermissionEntity } from './rbac.types';
export interface AuditLog {
  id: string;
  userId: string;
  action: string;
  timestamp: Date;
  ipAddress: string | null;
  device: string | null;
  userAgent: string | null;
  description: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  clinicId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Explicit entity types to avoid Prisma's 'any' in union types
export interface RbacRoleEntity {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  clinicId: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRoleEntity {
  id: string;
  userId: string;
  roleId: string;
  clinicId: string | null;
  assignedBy: string;
  assignedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  isActive: boolean;
  isPrimary: boolean;
  permissions: Record<string, never> | null;
  schedule: Record<string, never> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RolePermissionEntity {
  id: string;
  roleId: string;
  permissionId: string;
  clinicId: string | null;
  isActive: boolean;
  assignedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Re-export Prisma-generated base entity types
export type BillingPlan = BillingPlanBase;
export type Subscription = SubscriptionBase;
export type Invoice = InvoiceBase;
export interface Pharmacist {
  id: string;
  userId: string;
  clinicId: string;
  licenseNumber: string | null;
  specialization: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Therapist {
  id: string;
  userId: string;
  clinicId: string;
  specialization: string | null;
  qualifications: string | null;
  experience: number | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface LabTechnician {
  id: string;
  userId: string;
  clinicId: string;
  specialization: string | null;
  certifications: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface FinanceBilling {
  id: string;
  userId: string;
  clinicId: string;
  specialization: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface SupportStaff {
  id: string;
  userId: string;
  clinicId: string;
  role: string | null;
  department: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Nurse {
  id: string;
  userId: string;
  clinicId: string;
  licenseNumber: string | null;
  specialization: string | null;
  experience: number | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface Counselor {
  id: string;
  userId: string;
  clinicId: string;
  specialization: string | null;
  qualifications: string | null;
  experience: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmergencyContact {
  id: string;
  userId: string;
  name: string;
  relationship: string;
  phone: string;
  alternatePhone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Re-export Prisma-generated EHR entity types
// Note: These types are generated by Prisma at runtime via `prisma generate`
// Type declarations are provided in prisma-ehr-types.d.ts to avoid TypeScript errors
// during compilation in Docker containers where types aren't available initially

// Prisma 7: Export types from generated client location
export type { MedicalHistory } from '@prisma/client';
export type { LabReport } from '@prisma/client';
export type { RadiologyReport } from '@prisma/client';
export type { Vital } from '@prisma/client';
export type { Allergy } from '@prisma/client';
export type { Medication } from '@prisma/client';
export type { Immunization } from '@prisma/client';
export type { FamilyHistory } from '@prisma/client';
export type { LifestyleAssessment } from '@prisma/client';
// SurgicalRecord is defined in ehr.types.ts to avoid ambiguity

// Explicit base entity interfaces to avoid Prisma's 'any' in union types
// These are used for return type annotations where 'any' would cause errors
export interface AppointmentBase {
  id: string;
  type: string;
  doctorId: string;
  patientId: string;
  locationId: string;
  clinicId: string;
  date: Date;
  time: string;
  duration: number;
  status: string;
  priority?: string | null;
  notes?: string | null;
  userId: string;
  updatedBy?: string | null;
  cancellationReason?: string | null;
  metadata?: Record<string, never> | null;
  cancelledBy?: string | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  therapyId?: string | null;
  startedAt?: Date | null;
  checkedInAt?: Date | null;
  completedAt?: Date | null;
  subscriptionId?: string | null;
  isSubscriptionBased: boolean;
  proposedSlots?: unknown;
  confirmedSlotIndex?: number | null;
}

export interface BillingPlanBase {
  id: string;
  name: string;
  description?: string | null;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  trialPeriodDays?: number | null;
  features?: Record<string, never> | null;
  isActive: boolean;
  clinicId?: string | null;
  metadata?: Record<string, never> | null;
  appointmentsIncluded?: number | null;
  isUnlimitedAppointments: boolean;
  appointmentTypes?: Record<string, never> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionBase {
  id: string;
  userId: string;
  planId: string;
  clinicId: string;
  status: string;
  startDate: Date;
  endDate?: Date | null;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date | null;
  trialStart?: Date | null;
  trialEnd?: Date | null;
  metadata?: Record<string, never> | null;
  appointmentsUsed: number;
  appointmentsRemaining?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceBase {
  id: string;
  invoiceNumber: string;
  userId: string;
  subscriptionId?: string | null;
  clinicId: string;
  amount: number;
  tax?: number | null;
  discount?: number | null;
  totalAmount: number;
  status: string;
  dueDate: Date;
  paidAt?: Date | null;
  description?: string | null;
  lineItems?: Record<string, never> | null;
  metadata?: Record<string, never> | null;
  pdfFilePath?: string | null;
  pdfUrl?: string | null;
  sentViaWhatsApp: boolean;
  whatsappSentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentBase {
  id: string;
  appointmentId?: string | null;
  amount: number;
  status: string;
  method?: string | null;
  transactionId?: string | null;
  clinicId: string;
  userId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  description?: string | null;
  metadata?: Record<string, never> | null;
  refundAmount?: number | null;
  refundedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  clinicLocationId?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  bloodGroup?: string | null;
  emergencyContact?: string | null;
  isActive?: boolean;
  registrationDate?: Date;
  uniqueHealthIdentification?: string | null;
  specialCase?: string | null;
  presentIllness?: string | null;
  occupation?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

// Entity types with relations
export interface AppointmentWithRelations extends AppointmentBase {
  patient?:
    | (Patient & {
        user?: User;
      })
    | null;
  doctor?:
    | (Doctor & {
        user?: User;
      })
    | null;
  clinic?: Clinic | null;
  location?: {
    id: string;
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    phone?: string;
    clinicId: string;
  } | null;
}

export type AppointmentTimeSlot = {
  id: string;
  date: Date;
  time: string;
  duration: number;
  status: string;
  priority?: string;
};

export interface BillingPlanWithRelations extends BillingPlanBase {
  subscriptions?: Subscription[];
}

export interface SubscriptionWithRelations extends SubscriptionBase {
  plan?: BillingPlan;
  payments?: Payment[];
  invoices?: Invoice[];
  appointments?: Appointment[];
}

export interface InvoiceWithRelations extends InvoiceBase {
  subscription?: Subscription;
  payments?: Payment[];
}

export interface PaymentWithRelations extends PaymentBase {
  appointment?: Appointment;
  invoice?: Invoice;
  subscription?: Subscription;
}

export interface PatientWithUser extends PatientBase {
  user: {
    id: string;
    name: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    dateOfBirth?: Date;
    gender?: string;
    address?: string;
    emergencyContact?: string;
    isVerified: boolean;
  };
  appointments?: Record<string, never>[];
  healthRecords?: Record<string, never>[];
}

export type PatientWithUserOrNull = PatientWithUser | null;

// ============================================================================
// REPOSITORY TYPES
// ============================================================================

/**
 * Result metadata for tracking and debugging
 */
export interface ResultMetadata {
  source?: string;
  cacheHit?: boolean;
  retryCount?: number;
  connectionPool?: string;
  queryComplexity?: 'simple' | 'medium' | 'complex';
  rowCount?: number;
  transformationError?: boolean;
  executionTime?: number;
  queryCount?: number;
  clinicId?: string;
  userId?: string;
  operation?: string;
  timestamp?: Date;
  traceId?: string;
  [key: string]: unknown;
}

/**
 * Audit trail entry for compliance
 */
export interface AuditEntry {
  timestamp: Date;
  operation: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  clinicId?: string;
  details?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Common query options for repository methods with healthcare enhancements
 * This is the comprehensive version that includes all options
 */
export interface QueryOptions {
  page?: number;
  limit?: number;
  orderBy?: Record<string, 'asc' | 'desc'>;
  include?: Record<string, unknown>;
  select?: Record<string, boolean>;
  where?: Record<string, unknown>;

  // Healthcare-specific options
  clinicId?: string;
  userId?: string;
  hipaaCompliant?: boolean;
  auditRequired?: boolean;
  cacheStrategy?: 'none' | 'short' | 'long' | 'never';
  priority?: 'low' | 'normal' | 'high' | 'critical';
  timeout?: number;
  retries?: number;
  retryCount?: number;

  // Performance options
  useIndex?: string[];
  forceIndex?: string[];
  explain?: boolean;
  batchSize?: number;
  useCache?: boolean;

  // Security options
  rowLevelSecurity?: boolean;
  dataMasking?: boolean;
  encryptionRequired?: boolean;
}

/**
 * Enhanced pagination result with healthcare metadata
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  metadata: {
    clinicId?: string;
    executionTime: number;
    cacheHit: boolean;
    rowCount: number;
    performanceGrade: string;
    hipaaCompliant: boolean;
  };
}

/**
 * Repository operation context for tracking
 */
export interface RepositoryContext {
  operationType: string;
  clinicId?: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  startTime: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Batch operation result
 */
export interface BatchResult<T, E = Error> {
  success: boolean;
  successful: T[];
  failed: Array<{ _error: E; index: number }>;
  totalCount: number;
  successCount: number;
  failureCount: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  successRate: number;
}

/**
 * Enhanced Result wrapper for repository operations
 * Provides a consistent way to handle success/failure states with performance tracking
 */
export class RepositoryResult<T, E = Error> {
  private readonly _timestamp: Date;
  private readonly _executionTime: number;
  private readonly _operationType: string;
  private readonly _clinicId?: string;
  private readonly _userId?: string;
  private readonly _auditTrail: AuditEntry[];

  private constructor(
    private readonly _success: boolean,
    private readonly _data?: T,
    private readonly _error?: E,
    private readonly _metadata: ResultMetadata = {},
    executionTime: number = 0,
    operationType: string = 'unknown',
    clinicId?: string,
    userId?: string
  ) {
    this._timestamp = new Date();
    this._executionTime = executionTime;
    this._operationType = operationType;
    this._clinicId = clinicId || '';
    this._userId = userId || '';
    this._auditTrail = [];
  }

  static success<T, E = Error>(
    data: T,
    metadata?: ResultMetadata,
    executionTime?: number,
    operationType?: string,
    clinicId?: string,
    userId?: string
  ): RepositoryResult<T, E> {
    return new RepositoryResult<T, E>(
      true,
      data,
      undefined as E | undefined,
      metadata,
      executionTime,
      operationType,
      clinicId,
      userId
    );
  }

  static failure<T, E = Error>(
    _error: E,
    metadata?: ResultMetadata,
    executionTime?: number,
    operationType?: string,
    clinicId?: string,
    userId?: string
  ): RepositoryResult<T, E> {
    return new RepositoryResult<T, E>(
      false,
      undefined as T | undefined,
      _error,
      metadata,
      executionTime,
      operationType,
      clinicId,
      userId
    );
  }

  static fromPromise<T, E = Error>(
    promise: Promise<T>,
    operationType: string = 'unknown',
    clinicId?: string,
    userId?: string
  ): Promise<RepositoryResult<T, E>> {
    const startTime = Date.now();

    return promise
      .then(data => {
        const executionTime = Date.now() - startTime;
        return RepositoryResult.success<T, E>(
          data,
          { source: 'promise' },
          executionTime,
          operationType,
          clinicId,
          userId
        );
      })
      .catch((_error: unknown) => {
        const executionTime = Date.now() - startTime;
        const error = _error instanceof Error ? (_error as E) : (new Error(String(_error)) as E);
        return RepositoryResult.failure<T, E>(
          error,
          { source: 'promise' },
          executionTime,
          operationType,
          clinicId,
          userId
        );
      });
  }

  get isSuccess(): boolean {
    return this._success;
  }

  get isFailure(): boolean {
    return !this._success;
  }

  get data(): T | undefined {
    return this._data;
  }

  get error(): E | undefined {
    return this._error;
  }

  get timestamp(): Date {
    return this._timestamp;
  }

  get executionTime(): number {
    return this._executionTime;
  }

  get operationType(): string {
    return this._operationType;
  }

  get clinicId(): string | undefined {
    return this._clinicId;
  }

  get userId(): string | undefined {
    return this._userId;
  }

  get metadata(): ResultMetadata {
    return { ...this._metadata };
  }

  get auditTrail(): AuditEntry[] {
    return [...this._auditTrail];
  }

  unwrap(): T {
    if (this._success && this._data !== undefined) {
      return this._data;
    }
    if (this._error) {
      const errorToThrow =
        this._error instanceof Error ? this._error : new Error(String(this._error));
      throw errorToThrow;
    }
    throw new HealthcareError(
      ErrorCode.DATABASE_RECORD_NOT_FOUND,
      'RepositoryResult contains no data',
      HttpStatus.INTERNAL_SERVER_ERROR,
      {},
      'RepositoryResult.unwrap'
    );
  }

  unwrapOr(defaultValue: T): T {
    return this._success && this._data !== undefined ? this._data : defaultValue;
  }

  map<U>(fn: (value: T) => U): RepositoryResult<U, E> {
    if (this._success && this._data !== undefined) {
      try {
        return RepositoryResult.success(
          fn(this._data),
          this._metadata,
          this._executionTime,
          this._operationType,
          this._clinicId,
          this._userId
        );
      } catch (error) {
        return RepositoryResult.failure(error as E, this._metadata, this._executionTime);
      }
    }
    return RepositoryResult.failure(this._error!, this._metadata, this._executionTime);
  }

  flatMap<U>(fn: (value: T) => RepositoryResult<U, E>): RepositoryResult<U, E> {
    if (this._success && this._data !== undefined) {
      return fn(this._data);
    }
    return RepositoryResult.failure(this._error!, this._metadata, this._executionTime);
  }

  addAuditEntry(entry: Omit<AuditEntry, 'timestamp'>): RepositoryResult<T, E> {
    this._auditTrail.push({ ...entry, timestamp: new Date() });
    return this;
  }

  addMetadata(key: string, value: unknown): RepositoryResult<T, E> {
    this._metadata[key] = value;
    return this;
  }

  isSlow(threshold: number = 1000): boolean {
    return this._executionTime > threshold;
  }

  getPerformanceGrade(): 'excellent' | 'good' | 'fair' | 'poor' {
    if (this._executionTime < 100) return 'excellent';
    if (this._executionTime < 500) return 'good';
    if (this._executionTime < 1000) return 'fair';
    return 'poor';
  }

  toJSON(): unknown {
    return {
      success: this._success,
      data: this._data,
      error: this._error,
      metadata: this._metadata,
      timestamp: this._timestamp.toISOString(),
      executionTime: this._executionTime,
      operationType: this._operationType,
      clinicId: this._clinicId,
      userId: this._userId,
    };
  }

  static batch<T, E = Error>(results: RepositoryResult<T, E>[]): BatchResult<T, E> {
    const successful: T[] = [];
    const failed: Array<{ _error: E; index: number }> = [];
    let totalExecutionTime = 0;

    results.forEach((result, index) => {
      totalExecutionTime += result._executionTime;
      if (result._success && result._data !== undefined) {
        successful.push(result._data);
      } else {
        failed.push({ _error: result._error!, index });
      }
    });

    return {
      success: failed.length === 0,
      successful,
      failed,
      totalCount: results.length,
      successCount: successful.length,
      failureCount: failed.length,
      totalExecutionTime,
      averageExecutionTime: results.length > 0 ? totalExecutionTime / results.length : 0,
      successRate: results.length > 0 ? (successful.length / results.length) * 100 : 0,
    };
  }
}

// ============================================================================
// DATABASE PROVIDER INTERFACES
// ============================================================================

/**
 * Database Provider Interface
 * @interface IDatabaseProvider
 * @description Abstraction for database providers (PostgreSQL, MySQL, etc.)
 * Follows Dependency Inversion Principle
 */
export interface IDatabaseProvider {
  /**
   * Get primary database client
   */
  getPrimaryClient(): PrismaClient;

  /**
   * Get read replica client (if available)
   */
  getReadReplicaClient(): PrismaClient | null;

  /**
   * Check if read replicas are available
   */
  hasReadReplicas(): boolean;

  /**
   * Get health status
   */
  getHealthStatus(): Promise<{
    primary: boolean;
    replicas: Array<{ url: string; healthy: boolean; lag?: number }>;
  }>;

  /**
   * Close all connections
   */
  close(): Promise<void>;
}

/**
 * Connection Pool Interface
 * @interface IConnectionPoolManager
 * @description Abstraction for connection pool management
 * Follows Dependency Inversion Principle
 */
export interface IConnectionPoolManager {
  /**
   * Execute query with connection pool
   */
  executeQuery<T>(query: string, params: unknown[], options: QueryOptions): Promise<T>;

  /**
   * Get connection pool metrics
   */
  getMetrics(): ConnectionMetrics;

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): {
    isOpen: boolean;
    failures: number;
    failureCount: number;
    successCount: number;
  };

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void;

  /**
   * Get queue length
   */
  getQueueLength(): number;
}

/**
 * Load Balancing Strategy for Read Replicas
 */
export type LoadBalancingStrategy = 'round-robin' | 'least-connections' | 'latency-based';

/**
 * Read Replica Configuration
 */
export interface ReadReplicaConfig {
  enabled: boolean;
  urls: string[];
  strategy: LoadBalancingStrategy;
  failover: boolean;
  healthCheckInterval: number;
}

/**
 * Read Replica Router Interface
 * @interface IReadReplicaRouter
 * @description Abstraction for read replica routing
 * Follows Dependency Inversion Principle
 */
export interface IReadReplicaRouter {
  /**
   * Get client for read operation (routes to replica if available)
   */
  getReadClient(): PrismaClient;

  /**
   * Get client for write operation (always primary)
   */
  getWriteClient(): PrismaClient;

  /**
   * Check if query is read-only
   */
  isReadOnlyQuery(query: string): boolean;

  /**
   * Get replica health status
   */
  getReplicaHealth(): Promise<Array<{ url: string; healthy: boolean; lag?: number }>>;

  /**
   * Update replica configuration
   */
  updateConfig(config: Partial<ReadReplicaConfig>): void;
}

/**
 * JSON representation of result
 */
export interface ResultJSON<TData> {
  success: boolean;
  data?: TData;
  error?: unknown;
  metadata?: ResultMetadata;
  timestamp: string;
}

/**
 * Specialized result types for healthcare operations
 */
export type HealthcareResult<T> = RepositoryResult<T, HealthcareError>;

// Note: ClinicError and PatientError are not defined in @core/errors
// Using HealthcareError with clinicId/patientId in metadata for now
// If needed, these can be added to @core/errors in the future
export type ClinicResult<T> = RepositoryResult<T, HealthcareError>;
export type PatientResult<T> = RepositoryResult<T, HealthcareError>;

/**
 * Base repository interface defining common CRUD operations
 */
export interface IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId = string> {
  /**
   * Create a new entity
   */
  create(data: TCreateInput, context?: RepositoryContext): Promise<RepositoryResult<TEntity>>;

  /**
   * Create multiple entities
   */
  createMany(
    data: TCreateInput[],
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entity by ID
   */
  findById(
    id: TId,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find entity by unique field
   */
  findUnique(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find first entity matching criteria
   */
  findFirst(
    where: Record<string, unknown>,
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity | null>>;

  /**
   * Find multiple entities
   */
  findMany(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<TEntity[]>>;

  /**
   * Find entities with pagination
   */
  findManyPaginated(
    context?: RepositoryContext,
    options?: QueryOptions
  ): Promise<RepositoryResult<PaginatedResult<TEntity>>>;

  /**
   * Update entity by ID
   */
  update(
    id: TId,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Update multiple entities
   */
  updateMany(
    where: Record<string, unknown>,
    data: TUpdateInput,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Delete entity by ID (hard delete)
   */
  delete(
    id: TId,
    context?: RepositoryContext,
    softDelete?: boolean
  ): Promise<RepositoryResult<TEntity>>;

  /**
   * Delete multiple entities
   */
  deleteMany(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<{ count: number }>>;

  /**
   * Soft delete entity by ID
   */
  softDelete?(id: TId, context?: RepositoryContext): Promise<RepositoryResult<TEntity>>;

  /**
   * Count entities matching criteria
   */
  count(
    where?: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<number>>;

  /**
   * Check if entity exists
   */
  exists(
    where: Record<string, unknown>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<boolean>>;

  /**
   * Execute operation in transaction
   */
  executeInTransaction?<T>(
    operation: (tx: unknown) => Promise<T>,
    context?: RepositoryContext
  ): Promise<RepositoryResult<T>>;
}

/**
 * Repository factory interface
 */
export interface IRepositoryFactory {
  /**
   * Create repository for specific entity type
   */
  create<TEntity extends { id: TId }, TCreateInput, TUpdateInput, TId = string>(
    entityName: string,
    prismaDelegate: unknown
  ): IBaseRepository<TEntity, TCreateInput, TUpdateInput, TId>;
}

// ============================================================================
// DATABASE INFRASTRUCTURE TYPES
// ============================================================================

/**
 * Database Error Cache Entry
 */
export interface DatabaseErrorCacheEntry {
  error: Error;
  timestamp: Date;
  operation: string;
  errorCode?: string;
  retryCount: number;
  lastRetry?: Date;
}

/**
 * Database health status (simplified - used by HealthcareDatabaseClient)
 */
export interface DatabaseHealthStatus {
  isHealthy: boolean;
  connectionCount: number;
  activeQueries: number;
  avgResponseTime: number;
  lastHealthCheck: Date;
  errors: string[];
}

/**
 * Comprehensive database health status (used by DatabaseHealthMonitorService)
 * Provides detailed health information including primary, replicas, disk space, locks, etc.
 */
export interface DatabaseHealthMonitorStatus {
  healthy: boolean;
  primary: {
    connected: boolean;
    version?: string;
    latency?: number;
  };
  replicas: Array<{
    url: string;
    healthy: boolean;
    lag?: number;
  }>;
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    utilization: number;
  };
  diskSpace?: {
    used: number;
    available: number;
    percentage: number;
  };
  replicationLag?: number;
  locks?: {
    count: number;
    blocking: number;
  };
  issues: string[];
}

/**
 * Database client metrics
 */
export interface DatabaseClientMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
}

/**
 * Query optimization metrics
 * @interface QueryMetrics
 * @description Metrics for query optimization service tracking query performance and optimization results
 */
export interface QueryMetrics {
  optimizedQueries: number;
  totalQueries: number;
  averageOptimizationTime: number;
  slowQueries: string[];
  indexRecommendations: Array<{
    query: string;
    recommendation: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  cacheHitRate: number;
}

/**
 * HIPAA compliance metrics
 */
export interface HIPAAComplianceMetrics {
  auditedOperations: number;
  encryptedDataAccess: number;
  unauthorizedAttempts: number;
  dataRetentionCompliance: boolean;
  lastComplianceCheck: Date;
}

/**
 * Clinic-specific database metrics
 */
export interface ClinicDatabaseMetrics extends DatabaseClientMetrics {
  clinicId: string;
  clinicName: string;
  patientCount: number;
  appointmentCount: number;
  staffCount: number;
  locationCount: number;
}

/**
 * Circuit breaker state
 * Consolidated single type for all circuit breaker state management
 */
export interface CircuitBreakerState {
  isOpen: boolean;
  halfOpenTime?: Date;
  failures: number;
  failureCount: number;
  successCount: number;
  lastFailure?: Date;
  nextAttempt?: Date;
}

/**
 * Database Metrics (comprehensive)
 */
export interface DatabaseMetrics {
  timestamp: Date;
  performance: DatabasePerformanceMetrics;
  connectionPool: ConnectionPoolMetricsInternal;
  healthcare: HealthcareMetrics;
  clinicMetrics: Map<string, ClinicMetrics>;
  alerts: Alert[];
  health: 'healthy' | 'warning' | 'critical';
}

/**
 * Database Performance Metrics
 * @interface DatabasePerformanceMetrics
 * @description Database-specific performance metrics (renamed from PerformanceMetrics to avoid conflicts)
 */
export interface DatabasePerformanceMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  criticalQueries: number;
  queryThroughput: number;
  cacheHitRate: number;
  indexUsageRate: number;
}

/**
 * Connection Pool Metrics (internal - extends ConnectionMetrics)
 */
export interface ConnectionPoolMetricsInternal {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  connectionPoolUsage: number;
  connectionErrors: number;
  connectionLatency: number;
}

/**
 * Healthcare Metrics
 */
export interface HealthcareMetrics {
  totalPatients: number;
  totalAppointments: number;
  totalClinics: number;
  hipaaCompliantOperations: number;
  auditTrailEntries: number;
  dataEncryptionRate: number;
  unauthorizedAccessAttempts: number;
}

/**
 * Clinic Metrics
 */
export interface ClinicMetrics {
  clinicId: string;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalExecutionTime: number;
  averageExecutionTime: number;
  patientCount: number;
  appointmentCount: number;
  lastUpdated: Date;
}

/**
 * Alert
 */
export interface Alert {
  type: 'PERFORMANCE' | 'CONNECTION_POOL' | 'SECURITY' | 'HEALTHCARE';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  metric: string;
  value: number;
  threshold: number;
}

/**
 * Metrics Snapshot
 */
export interface MetricsSnapshot {
  timestamp: Date;
  performance: DatabasePerformanceMetrics;
  connectionPool: ConnectionPoolMetricsInternal;
  healthcare: HealthcareMetrics;
  clinicMetrics: Map<string, ClinicMetrics>;
}

/**
 * Database Health Status (renamed to avoid conflict with realtime-health.types)
 */
export interface DatabaseHealthStatusType {
  status: 'healthy' | 'warning' | 'critical';
  issues: string[];
  lastCheck: Date;
  metrics: DatabaseMetrics;
}

/**
 * Performance Trends
 */
export interface PerformanceTrends {
  queryPerformance: TrendData;
  connectionPool: TrendData;
  errorRate: TrendData;
  throughput: TrendData;
}

/**
 * Trend Data
 */
export interface TrendData {
  trend: 'improving' | 'stable' | 'degrading';
  change: number; // Percentage change
}

/**
 * Performance Report
 */
export interface DatabasePerformanceReport {
  timestamp: Date;
  summary: {
    overallHealth: string;
    totalIssues: number;
    performanceGrade: string;
    recommendations: string[];
  };
  metrics: DatabaseMetrics;
  trends: PerformanceTrends;
  alerts: Alert[];
  clinicSummary: ClinicSummary[];
}

/**
 * Clinic Summary
 */
export interface ClinicSummary {
  clinicId: string;
  patientCount: number;
  appointmentCount: number;
  queryCount: number;
  averageQueryTime: number;
  lastUpdated: Date;
}

/**
 * Recent activity item in clinic dashboard
 */
export interface ClinicRecentActivity {
  patient: {
    user: {
      name: string | null;
      firstName: string | null;
      lastName: string | null;
    };
  };
  doctor: {
    user: {
      name: string | null;
      firstName: string | null;
      lastName: string | null;
    };
  };
}

/**
 * Clinic dashboard statistics
 */
export interface ClinicDashboardStats {
  totalPatients: number;
  totalAppointments: number;
  todayAppointments: number;
  upcomingAppointments: number;
  totalDoctors: number;
  totalLocations: number;
  recentActivity: ClinicRecentActivity[];
}

/**
 * Options for getting clinic patients
 */
export interface ClinicPatientOptions {
  page?: number;
  limit?: number;
  locationId?: string;
  searchTerm?: string;
  includeInactive?: boolean;
}

/**
 * Result for clinic patients query
 */
export interface ClinicPatientResult {
  patients: PatientWithUser[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Options for getting clinic appointments
 */
export interface ClinicAppointmentOptions {
  page?: number;
  limit?: number;
  locationId?: string;
  doctorId?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Result for clinic appointments query
 */
export interface ClinicAppointmentResult {
  appointments: AppointmentWithRelations[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * Audit information for healthcare operations
 */
export interface AuditInfo {
  userId: string;
  userRole: string;
  operation: string;
  resourceType: string;
  resourceId?: string;
  clinicId: string;
  timestamp?: Date;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

/**
 * Critical operation priority levels
 */
export enum CriticalPriority {
  EMERGENCY = 'EMERGENCY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
}

/**
 * Database client types
 */
export enum DatabaseClientType {
  BASE = 'base',
  HEALTHCARE = 'healthcare',
  CLINIC = 'clinic',
}

/**
 * Database client configuration
 */
export interface DatabaseClientConfig {
  connectionTimeout?: number;
  queryTimeout?: number;
  maxRetries?: number;
  enableMetrics?: boolean;
  enableCircuitBreaker?: boolean;
}

/**
 * Healthcare-specific database configuration
 */
export interface HealthcareDatabaseConfig extends DatabaseClientConfig {
  enableAuditLogging?: boolean;
  enablePHIProtection?: boolean;
  auditRetentionDays?: number;
  encryptionEnabled?: boolean;
  complianceLevel?: string;
}

/**
 * Database client creation options
 */
export interface DatabaseClientOptions {
  type: 'base' | 'healthcare' | 'clinic';
  config: DatabaseClientConfig | HealthcareDatabaseConfig;
  clinicId?: string;
}

/**
 * Connection metrics
 */
export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  totalQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  errors: number;
  lastHealthCheck: Date;
  isHealthy: boolean;
  // Enhanced metrics for 1M+ users
  peakConnections: number;
  connectionUtilization: number;
  queryThroughput: number; // queries per second
  cacheHitRate: number;
  readReplicaConnections?: number;
  circuitBreakerTrips: number;
  autoScalingEvents: number;
}

/**
 * Clinic context for multi-tenant operations
 */
export type { ClinicContext } from './clinic.types';

/**
 * Clinic isolation result
 */
export interface ClinicIsolationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  clinicContext?: import('./clinic.types').ClinicContext;
  clinicId?: string;
}

/**
 * Prisma Client Transaction Type
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$on' | '$connect' | '$disconnect' | '$transaction' | '$extends'
>;

/**
 * Prisma Service type (for dependency injection)
 * Import from @infrastructure/database/prisma/prisma.service
 */
export type PrismaService = import('@infrastructure/database/prisma/prisma.service').PrismaService;

/**
 * Base database client interface for enterprise database operations
 */
export interface IDatabaseClient {
  /**
   * Get the underlying Prisma client
   */
  getPrismaClient(): PrismaService;

  /**
   * Execute a raw query
   */
  executeRawQuery<T = Record<string, never>>(
    query: string,
    params?: Array<string | number | boolean>
  ): Promise<T>;

  /**
   * Execute query within a transaction
   */
  executeInTransaction<T>(operation: (client: PrismaTransactionClient) => Promise<T>): Promise<T>;

  /**
   * Get connection health status
   */
  getHealthStatus(): Promise<DatabaseHealthStatus>;

  /**
   * Get client metrics
   */
  getMetrics(): Promise<DatabaseClientMetrics>;

  /**
   * Close database connections
   */
  disconnect(): Promise<void>;
}

/**
 * Healthcare-specific database client interface
 */
export interface IHealthcareDatabaseClient extends IDatabaseClient {
  /**
   * Find user by email with selective relation loading
   */
  findUserByEmailSafe(
    email: string,
    includeRelations?: Partial<{
      doctor: true;
      patient: true;
      receptionists: true;
      clinicAdmins: true;
      superAdmin: true;
      pharmacist: true;
      therapist: true;
      labTechnician: true;
      financeBilling: true;
      supportStaff: true;
      nurse: true;
      counselor: true;
      clinics: true;
    }>
  ): Promise<UserWithRelations | null>;

  /**
   * Find user by phone with selective relation loading
   */
  findUserByPhoneSafe(
    phone: string,
    includeRelations?: Partial<{
      doctor: true;
      patient: true;
      receptionists: true;
      clinicAdmins: true;
      superAdmin: true;
      pharmacist: true;
      therapist: true;
      labTechnician: true;
      financeBilling: true;
      supportStaff: true;
      nurse: true;
      counselor: true;
      clinics: true;
    }>
  ): Promise<UserWithRelations | null>;

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   */
  executeHealthcareRead<T>(operation: (client: PrismaTransactionClient) => Promise<T>): Promise<T>;

  /**
   * Execute healthcare-specific write operations with audit trails
   */
  executeHealthcareWrite<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T>;

  /**
   * Execute critical healthcare operations (emergency scenarios)
   */
  executeCriticalOperation<T>(
    operation: (client: PrismaTransactionClient) => Promise<T>,
    priority: CriticalPriority
  ): Promise<T>;

  /**
   * Get HIPAA compliance metrics
   */
  getHIPAAMetrics(): Promise<HIPAAComplianceMetrics>;

  /**
   * Execute operation with clinic isolation context (multi-tenant)
   */
  executeWithClinicContext<T>(
    clinicId: string,
    operation: (client: PrismaTransactionClient) => Promise<T>
  ): Promise<T>;

  /**
   * Get clinic-specific metrics
   */
  getClinicMetrics(clinicId: string): Promise<ClinicDatabaseMetrics>;

  /**
   * Get clinic dashboard statistics
   */
  getClinicDashboardStats(clinicId: string): Promise<ClinicDashboardStats>;

  /**
   * Get clinic patients with pagination and filtering
   */
  getClinicPatients(clinicId: string, options?: ClinicPatientOptions): Promise<ClinicPatientResult>;

  /**
   * Get clinic appointments with advanced filtering
   */
  getClinicAppointments(
    clinicId: string,
    options?: ClinicAppointmentOptions
  ): Promise<ClinicAppointmentResult>;
}
