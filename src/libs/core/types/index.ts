/**
 * Core types for the healthcare application
 * @module CoreTypes
 * @description Central type definitions for authentication, user management, and system operations
 *
 * Note: Authentication-related types (AuthResponse, AuthTokens, TokenPayload, UserProfile,
 * PasswordResetResult, MagicLinkResult, OtpResult) are now consolidated in @core/types/auth.types.ts
 * and re-exported via 'export * from './auth.types'' below
 */

// SessionData is now exported from session.types.ts

// AuthenticatedRequest - Re-exported from common.types.ts
// Note: AuthenticatedRequest is defined in common.types.ts and exported via 'export * from './common.types'' below
// The definition in common.types.ts is the canonical version with detailed user structure

export interface DomainValidationResult {
  isValid: boolean;
  message?: string;
  errors?: string[];
  metadata?: Record<string, unknown>;
}

// Health Check Types - Re-exported from common.types.ts
// Note: HealthCheckResponse, DetailedHealthCheckResponse, SystemMetrics, ProcessInfo, MemoryInfo, and CpuInfo
// are defined in common.types.ts and exported via 'export * from './common.types'' above
// No need to redefine them here - this would cause type conflicts

// RBAC Types (consolidated: includes role, permission, and RBAC types)
export * from './rbac.types';

// Common Types (consolidated: includes health, email, queue, request, business-rules)
export * from './common.types';
// Request Types (HTTP, WebSocket, Worker process types)
// Request Types (consolidated from request.types.ts into common.types.ts)
// Re-export request-related types from common.types.ts for backward compatibility
export type {
  AuthenticatedRequest,
  RateLimitContext,
  SerializedRequest,
  SocketConnection,
  WorkerProcess,
  FastifyLoggerConfig,
  RedisClient,
} from './common.types';

// Database Types (consolidated: includes entities, repository types, and database infrastructure)
export * from './database.types';

// User Types
export * from './user.types';

// Input Types
export * from './input.types';

// Enum Types (export everything - Role enum from enums.types will conflict with Role type from rbac.types, so we export Role enum with alias)
export {
  UserStatus,
  AppointmentStatus,
  PaymentStatus,
  PaymentMethod,
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
  Language,
  AppointmentType as AppointmentTypeEnum,
  QueueStatus,
  NotificationStatus,
  Dosha,
  Prakriti,
  MedicineType,
  TherapyType,
  TherapyDuration,
  AgniType,
  TherapyStatus,
  Role as RoleEnum,
  SpecialCase,
} from './enums.types';
// Export Role type from rbac.types as the primary Role
export type { Role } from './rbac.types';

// Prisma Types (All Prisma-related types consolidated in one file)
export * from './prisma.types';

// Cache Types (consolidated: includes cache configuration, metrics, and operations)
export * from './cache.types';

// Event Types (centralized event system types)
export * from './event.types';

// Logging Types (centralized logging system types)
export * from './logging.types';

// Queue Types (centralized queue system types)
export * from './queue.types';
// Export queue constants for direct access
export { QUEUE_NAMES, QUEUE_PRIORITIES } from './queue.types';
export type { QueueName, QueuePriority } from './queue.types';

// Session Types (centralized session management types)
export * from './session.types';

// Guard Types (centralized guard types for authentication and authorization)
export * from './guard.types';

// Infrastructure Types (consolidated: includes error handling and HTTP filter types)
export * from './infrastructure.types';

// Clinic Types (centralized clinic-related types)
export * from './clinic.types';

// Appointment Types (centralized appointment-related types)
// Exclude duplicates that are also in common.types and queue.types
export * from './appointment-guards.types';
export type {
  VideoCallAppointment,
  InPersonAppointment,
  HomeVisitAppointment,
  TypedAppointment,
  AppointmentByType,
} from './appointment.types';
export {
  AppointmentFilters,
  AppointmentWithRelationsController,
  ServiceResponse,
  AppointmentMetrics,
  DoctorMetrics,
  ClinicMetrics as AppointmentClinicMetrics,
  TimeSlotMetrics,
  AnalyticsFilter,
  AnalyticsResult,
  TimeSlot,
  AuditTrailEntry,
  ConflictResolutionOptions,
  AyurvedicTherapy,
  TherapySession,
  CreateTherapyDto,
  UpdateTherapyDto,
  TherapyQueueStats as AppointmentQueueStats,
  AppointmentQueuePosition,
  CheckInData,
  CheckInResult,
  DeviceInfo,
  CheckInAppointment,
  CheckedInAppointmentsResponse,
  QueueStatsResponse,
  LocationQueueResponse,
  WaitlistEntry,
  WaitlistMetrics,
  EligibilityCriteria,
  EligibilityCheck,
  FollowUpPlan,
  FollowUpTemplate,
  FollowUpResult,
  FollowUpReminder,
  AppointmentTemplate,
  AppointmentLocation,
  LocationStats,
  AppointmentLocationDoctor,
  NotificationData as AppointmentNotificationData,
  VideoConsultationSession,
  JitsiRoomConfig,
  VideoCall,
  VideoCallSettings,
  BusinessRule,
  DoctorQueueResponse,
  PatientQueuePositionResponse,
  OperationResponse,
  LocationQueueStatsResponse,
  QueueMetricsResponse,
} from './appointment.types';

// Notification Types (centralized notification-related types)
export * from './notification.types';

// Communication Types (unified communication service types)
export * from './communication.types';

// EHR Types (centralized EHR-related types)
export * from './ehr.types';

// Auth Types (centralized authentication-related types)
export * from './auth.types';

// App Types (centralized application dashboard and UI types)
export * from './app.types';

// Plugin Types (centralized plugin system types)
export * from './plugin.types';

// Config Types (centralized configuration types)
// Export specific types to avoid conflicts
export type {
  AppConfig,
  UrlsConfig,
  DomainsConfig,
  DatabaseConfig,
  RedisConfig,
  CacheConfig,
  JwtConfig,
  PrismaConfig,
  RateLimitConfig,
  EnhancedRateLimitConfig,
  LoggingConfig,
  EmailConfig,
  CorsConfig,
  SecurityConfig,
  WhatsappConfig,
  JitsiConfig,
  VideoProviderConfig,
  Config,
  ProductionConfig,
  Environment,
  ConfigValidationResult,
  RateLimitRule,
} from './config.types';
// Re-export utility types from constants (they're defined there)
export type { RedisPrefixKey, RedisPrefixValue, EnvVarName } from '@config/constants';

// Framework Types (consolidated: includes framework wrapper types and adapter interfaces)
export * from './framework.types';

// Video Types (centralized video provider types)
export * from './video.types';

// HTTP Types (HTTP service types for @nestjs/axios)
export * from './http.types';

// Payment Types (centralized payment provider types)
export * from './payment.types';

// Realtime Health Types (enterprise-level real-time health monitoring)
export * from './realtime-health.types';

// WhatsApp Suppression Types (type-safe Prisma delegate access)
export * from './whatsapp-suppression.types';
