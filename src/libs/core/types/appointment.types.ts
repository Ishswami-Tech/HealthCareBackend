/**
 * Centralized Appointment Types
 * @module @core/types/appointment.types
 * @description All appointment-related types and interfaces for the healthcare system
 */

import { AppointmentType } from './enums.types';
import type { AppointmentBase } from './database.types';

/**
 * ============================================================================
 * STRICT DISCRIMINATED UNION TYPES FOR ENTERPRISE-LEVEL TYPE SAFETY
 * ============================================================================
 * These types ensure compile-time type safety for appointment operations.
 * Each variant has its required fields based on appointment type.
 *
 * @see https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
 */

/**
 * Video call appointment - locationId is optional
 * @description VIDEO_CALL appointments don't require physical location
 */
export interface VideoCallAppointment extends Omit<AppointmentBase, 'type' | 'locationId'> {
  type: AppointmentType.VIDEO_CALL;
  locationId: string | null;
}

/**
 * In-person appointment - locationId is required
 * @description IN_PERSON appointments must have a physical location
 */
export interface InPersonAppointment extends Omit<AppointmentBase, 'type' | 'locationId'> {
  type: AppointmentType.IN_PERSON;
  locationId: string; // Required - non-nullable
}

/**
 * Home visit appointment - locationId is optional (uses patient address)
 * @description HOME_VISIT appointments may use patient's address
 */
export interface HomeVisitAppointment extends Omit<AppointmentBase, 'type' | 'locationId'> {
  type: AppointmentType.HOME_VISIT;
  locationId: string | null;
}

/**
 * Discriminated union of all appointment types
 * @description Type-safe union that allows TypeScript to narrow types based on 'type' field
 *
 * @example
 * ```typescript
 * function processAppointment(appointment: TypedAppointment) {
 *   if (appointment.type === AppointmentType.VIDEO_CALL) {
 *     // TypeScript knows appointment is VideoCallAppointment here
 *     // appointment.locationId is string | null
 *   } else if (appointment.type === AppointmentType.IN_PERSON) {
 *     // TypeScript knows appointment is InPersonAppointment here
 *     // appointment.locationId is string (required)
 *   }
 * }
 * ```
 */
export type TypedAppointment = VideoCallAppointment | InPersonAppointment | HomeVisitAppointment;

/**
 * Type helper to extract appointment type from union
 * @description Utility type for functions that work with specific appointment types
 *
 * @example
 * ```typescript
 * function createVideoRoom(
 *   appointment: Extract<TypedAppointment, { type: AppointmentType.VIDEO_CALL }>
 * ): Promise<VideoRoom> {
 *   // TypeScript guarantees appointment.type === VIDEO_CALL
 * }
 * ```
 */
export type AppointmentByType<T extends AppointmentType> = Extract<TypedAppointment, { type: T }>;

/**
 * Appointment context for operations
 */
export interface AppointmentContext {
  userId: string;
  role: string;
  clinicId: string;
  locationId?: string;
  doctorId?: string;
  patientId?: string;
}

/**
 * Generic appointment operation result
 */
export interface AppointmentResult<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  message: string;
  metadata?: {
    processingTime: number;
    conflicts?: ConflictDetails[];
    warnings?: string[];
    auditTrail?: AuditTrailEntry[];
    alternatives?: AlternativeSlot[];
  };
}

/**
 * Conflict details from scheduling resolution
 */
export interface ConflictDetails {
  type:
    | 'time_overlap'
    | 'doctor_unavailable'
    | 'resource_conflict'
    | 'business_rule'
    | 'capacity_exceeded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  conflictingAppointmentId?: string;
  conflictingTimeSlot?: TimeSlot;
  affectedResources: string[];
  resolution?: string;
}

/**
 * Alternative time slot suggestion
 */
export interface AlternativeSlot {
  startTime: Date;
  endTime: Date;
  doctorId: string;
  score: number; // 0-100, higher is better
  reason: string;
  availability: 'available' | 'preferred' | 'suboptimal';
  estimatedWaitTime?: number;
}

/**
 * Time slot representation
 */
export interface TimeSlot {
  startTime: Date;
  endTime: Date;
  doctorId: string;
  clinicId: string;
  isAvailable: boolean;
  appointmentId?: string;
  bufferMinutes?: number;
}

/**
 * Audit trail entry for HIPAA compliance
 */
export interface AuditTrailEntry {
  action: string;
  timestamp: Date;
  userId: string;
  details: Record<string, unknown>;
}

/**
 * Conflict resolution options
 */
export interface ConflictResolutionOptions {
  allowOverlap: boolean;
  bufferMinutes: number;
  emergencyOverride: boolean;
  suggestAlternatives: boolean;
  maxAlternatives: number;
  timeWindow: {
    startHour: number;
    endHour: number;
  };
  priorityLevels: {
    emergency: number;
    vip: number;
    regular: number;
    followup: number;
  };
}

/**
 * Conflict resolution result
 */
export interface ConflictResolutionResult {
  canSchedule: boolean;
  conflicts: ConflictDetails[];
  alternatives: AlternativeSlot[];
  resolution: {
    strategy: 'allow' | 'reject' | 'reschedule' | 'override';
    reason: string;
    actions: ResolutionAction[];
  };
  warnings: string[];
  metadata: {
    processingTimeMs: number;
    rulesApplied: string[];
    timestamp: Date;
  };
}

/**
 * Resolution action for conflicts
 */
export interface ResolutionAction {
  type: 'move_appointment' | 'notify_patient' | 'extend_hours' | 'add_resource' | 'escalate';
  description: string;
  parameters: Record<string, unknown>;
  requiredApproval?: boolean;
}

/**
 * Appointment request for scheduling
 */
export interface AppointmentRequest {
  patientId: string;
  doctorId: string;
  clinicId: string;
  requestedTime: Date;
  duration: number; // minutes
  priority: 'emergency' | 'vip' | 'regular' | 'followup';
  serviceType: string;
  notes?: string;
  preferredAlternatives?: Date[];
}

/**
 * Workflow context
 */
export interface WorkflowContext {
  appointmentId: string;
  userId: string;
  clinicId?: string;
  data: unknown;
}

/**
 * Workflow result
 */
export interface WorkflowResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

/**
 * Business rule evaluation context
 */
export interface RuleEvaluationContext {
  appointment: unknown;
  patient: unknown;
  doctor: unknown;
  clinic: unknown;
  location?: unknown;
  timeSlot?: unknown;
}

/**
 * Business rule evaluation result
 */
export interface RuleEvaluationResult {
  passed: boolean;
  appliedRules: string[];
  violations: string[];
  actions: Record<string, unknown>[];
}

/**
 * Business rule entity
 */
export interface BusinessRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  isActive: boolean;
  category: import('./common.types').RuleCategory;
  version: string;
  tags: readonly string[];
  conditions: readonly import('./common.types').RuleCondition[];
  actions: readonly import('./common.types').RuleAction[];
  clinicId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Appointment metrics data
 */
export interface AppointmentMetricsData {
  totalAppointments: number;
  appointmentsByStatus: Record<string, number>;
  appointmentsByPriority: Record<string, number>;
  averageDuration: number;
  conflictResolutionRate: number;
  noShowRate: number;
  completionRate: number;
  averageWaitTime: number;
  queueEfficiency: number;
}

/**
 * Check-in location for appointment check-ins
 */
export interface CheckInLocation {
  id: string;
  clinicId: string;
  locationId?: string | null; // Link to ClinicLocation
  locationName: string;
  coordinates: Record<string, number>;
  radius: number;
  isActive: boolean;
  qrCode?: string | null;
  qrCodeExpiry?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Check-in record
 */
export interface CheckIn {
  id: string;
  appointmentId: string;
  locationId: string;
  checkInTime: Date;
  isVerified: boolean;
  verifiedBy?: string | null;
  coordinates?: Record<string, number> | null;
  deviceInfo?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create check-in location DTO
 */
export interface CreateCheckInLocationDto {
  clinicId: string;
  locationName: string;
  coordinates: { lat: number; lng: number };
  radius: number; // in meters
}

/**
 * Update check-in location DTO
 */
export interface UpdateCheckInLocationDto {
  locationName?: string;
  coordinates?: { lat: number; lng: number };
  radius?: number;
  isActive?: boolean;
}

/**
 * Process check-in DTO
 */
export interface ProcessCheckInDto {
  appointmentId: string;
  locationId: string;
  patientId: string;
  coordinates?: { lat: number; lng: number };
  deviceInfo?: Record<string, unknown>;
  qrCode?: string;
}

/**
 * Verify check-in DTO
 */
export interface VerifyCheckInDto {
  checkInId: string;
  verifiedBy: string;
  notes?: string;
}

/**
 * Check-in validation result
 */
export interface CheckInValidation {
  isValid: boolean;
  distance?: number;
  message: string;
}

/**
 * Ayurvedic therapy entity
 */
export interface AyurvedicTherapy {
  id: string;
  name: string;
  description?: string | null;
  therapyType: string; // TherapyType enum
  duration: string; // TherapyDuration enum
  estimatedDuration: number;
  isActive: boolean;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
  sessions?: TherapySession[];
}

/**
 * Therapy session entity
 */
export interface TherapySession {
  id: string;
  therapyId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  scheduledDate: Date;
  startTime?: Date | null;
  endTime?: Date | null;
  status: string; // TherapyStatus enum
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create therapy DTO
 */
export interface CreateTherapyDto {
  name: string;
  description?: string;
  therapyType: string; // TherapyType enum
  duration: string; // TherapyDuration enum
  estimatedDuration: number; // in minutes
  clinicId: string;
}

/**
 * Update therapy DTO
 */
export interface UpdateTherapyDto {
  name?: string;
  description?: string;
  therapyType?: string; // TherapyType enum
  duration?: string; // TherapyDuration enum
  estimatedDuration?: number;
  isActive?: boolean;
}

/**
 * Create therapy session DTO
 */
export interface CreateTherapySessionDto {
  therapyId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  sessionDate: Date;
  startTime: Date;
  notes?: string;
  observations?: Record<string, unknown>;
}

/**
 * Update therapy session DTO
 */
export interface UpdateTherapySessionDto {
  endTime?: Date;
  status?: string; // TherapyStatus enum
  notes?: string;
  observations?: Record<string, unknown>;
  nextSessionDate?: Date;
}

// ============================================================================
// Therapy Queue Types
// ============================================================================

/**
 * Therapy queue entity
 */
export interface TherapyQueue {
  id: string;
  clinicId: string;
  therapyType: string; // TherapyType enum
  queueName: string;
  isActive: boolean;
  maxCapacity: number;
  currentPosition: number;
  estimatedWaitTime?: number | null;
  createdAt: Date;
  updatedAt: Date;
  queueEntries?: QueueEntry[];
}

/**
 * Queue entry entity
 */
export interface QueueEntry {
  id: string;
  queueId: string;
  appointmentId: string;
  patientId: string;
  position: number;
  priority: number;
  status: string; // QueueStatus enum
  estimatedWaitTime?: number | null;
  actualWaitTime?: number | null;
  checkedInAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create therapy queue DTO
 */
export interface CreateTherapyQueueDto {
  clinicId: string;
  therapyType: string; // TherapyType enum
  queueName: string;
  maxCapacity?: number;
}

/**
 * Create queue entry DTO
 */
export interface CreateQueueEntryDto {
  queueId: string;
  appointmentId: string;
  patientId: string;
  priority?: number;
  notes?: string;
}

/**
 * Update queue entry DTO
 */
export interface UpdateQueueEntryDto {
  position?: number;
  status?: string; // QueueStatus enum
  estimatedWaitTime?: number;
  actualWaitTime?: number;
  priority?: number;
  notes?: string;
}

/**
 * Therapy queue statistics (appointment-specific)
 * Note: This is different from the base QueueStats in common.types.ts
 * This is specifically for therapy queue metrics
 */
export interface TherapyQueueStats {
  queueId: string;
  therapyType: string;
  totalEntries: number;
  waiting: number;
  inProgress: number;
  completed: number;
  averageWaitTime: number;
  currentCapacity: number;
  maxCapacity: number;
  utilizationRate: number;
}

// ============================================================================
// Check-in Types
// ============================================================================

/**
 * Device information for check-in
 */
export interface DeviceInfo {
  userAgent: string;
  platform: string;
  language: string;
  timezone: string;
  screenResolution?: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
}

/**
 * Check-in data
 */
export interface CheckInData {
  appointmentId: string;
  userId: string;
  biometricData?: {
    fingerprint?: string;
    faceId?: string;
    voicePrint?: string;
  };
  checkInMethod: 'qr' | 'biometric' | 'manual';
  timestamp: string;
  locationId: string;
  coordinates?: { lat: number; lng: number };
  deviceInfo?: DeviceInfo;
  qrCode?: string;
}

/**
 * Check-in result
 */
export interface CheckInResult {
  success: boolean;
  appointmentId: string;
  queuePosition?: number;
  estimatedWaitTime?: number;
  message: string;
  checkedInAt: string;
}

/**
 * Appointment queue position information (appointment-specific)
 * Note: This is different from the base QueuePosition in common.types.ts
 * This includes appointment-specific fields like doctorId and locationId
 */
export interface AppointmentQueuePosition {
  position: number;
  totalInQueue: number;
  estimatedWaitTime: number;
  doctorId: string;
  locationId: string;
}

/**
 * Check-in appointment
 */
export interface CheckInAppointment {
  id: string;
  patientId: string;
  doctorId: string;
  locationId: string;
  type: string; // AppointmentType enum
  status: string; // AppointmentStatus enum
  domain?: string;
}

/**
 * Checked-in appointments response
 */
export interface CheckedInAppointmentsResponse {
  appointments: CheckInAppointment[];
  clinicId: string;
  total: number;
  retrievedAt: string;
}

/**
 * Queue statistics response
 */
export interface QueueStatsResponse {
  totalEntries: number;
  waitingEntries: number;
  inProgressEntries: number;
  completedEntries: number;
  averageWaitTime: number;
  estimatedWaitTime: number;
}

/**
 * Location queue response
 */
export interface LocationQueueResponse {
  locationId: string;
  queue: AppointmentQueuePosition[];
  total: number;
  retrievedAt: string;
}

/**
 * Doctor queue response for appointment queue service
 */
export interface DoctorQueueResponse {
  doctorId: string;
  date: string;
  domain: string;
  queue: QueueEntryData[];
  totalLength: number;
  averageWaitTime: number;
  estimatedNextWaitTime: number;
}

/**
 * Patient queue position response
 */
export interface PatientQueuePositionResponse {
  appointmentId: string;
  position: number;
  totalInQueue: number;
  estimatedWaitTime: number;
  domain: string;
  doctorId: string;
}

/**
 * Generic operation response
 */
export interface OperationResponse {
  success: boolean;
  message: string;
}

/**
 * Location queue statistics response
 */
export interface LocationQueueStatsResponse {
  locationId: string;
  domain: string;
  stats: {
    totalWaiting: number;
    averageWaitTime: number;
    efficiency: number;
    utilization: number;
    completedCount: number;
  };
}

/**
 * Queue metrics response with period-specific data
 */
export interface QueueMetricsResponse {
  locationId: string;
  domain: string;
  stats: {
    totalWaiting: number;
    averageWaitTime: number;
    efficiency: number;
    utilization: number;
    completedCount: number;
  };
  period: string;
  metrics: {
    efficiency: number;
    utilization: number;
    throughput: number;
    responseTime: number;
  };
}

// ============================================================================
// Controller Response Types
// ============================================================================

/**
 * Service response wrapper
 */
export interface ServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/**
 * Appointment filters for querying
 */
export interface AppointmentFilters {
  userId?: string;
  doctorId?: string;
  status?: string; // AppointmentStatus enum
  date?: string;
  locationId?: string;
  clinicId: string;
  page: number;
  limit: number;
}

/**
 * Appointment with relations for controller use
 */
export interface AppointmentWithRelationsController {
  id: string;
  patient?: {
    id: string;
    userId: string;
    name?: string;
    avatar?: string;
  };
  doctor?: {
    id: string;
    userId: string;
    name?: string;
    avatar?: string;
  };
  clinicId: string;
  status: string;
}

// ============================================================================
// APPOINTMENT RESOURCE TYPES
// ============================================================================

/**
 * Resource for appointment booking
 */
export interface Resource {
  id: string;
  name: string;
  type: 'room' | 'equipment' | 'vehicle' | 'other';
  clinicId: string;
  locationId?: string;
  capacity?: number;
  features: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resource booking for an appointment
 */
export interface ResourceBooking {
  id: string;
  resourceId: string;
  appointmentId: string;
  startTime: Date;
  endTime: Date;
  status: 'booked' | 'confirmed' | 'cancelled';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resource conflict information
 */
export interface ResourceConflict {
  resourceId: string;
  conflictingBookings: ResourceBooking[];
  suggestedAlternatives: Resource[];
  conflictType: 'time_overlap' | 'capacity_exceeded' | 'feature_mismatch';
}

// ============================================================================
// APPOINTMENT TEMPLATE TYPES
// ============================================================================

/**
 * Appointment template for recurring appointments
 */
export interface AppointmentTemplate {
  id: string;
  name: string;
  description?: string;
  clinicId: string;
  doctorId?: string;
  duration: number;
  type: string;
  recurringPattern: 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurringDays?: number[];
  recurringInterval: number;
  startDate: Date;
  endDate?: Date;
  timeSlots: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Prisma appointment template (nullable fields)
 */
export interface PrismaAppointmentTemplate {
  id: string;
  name: string;
  description: string | null;
  clinicId: string;
  doctorId: string | null;
  duration: number;
  type: string;
  recurringPattern: string | null;
  recurringDays: number[] | null;
  recurringInterval: number | null;
  startDate: Date;
  endDate: Date | null;
  timeSlots: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Recurring appointment series
 */
export interface RecurringAppointmentSeries {
  id: string;
  templateId: string;
  patientId: string;
  clinicId: string;
  startDate: Date;
  endDate?: Date;
  status: 'active' | 'paused' | 'cancelled';
  appointments: string[]; // appointment IDs
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// ELIGIBILITY TYPES
// ============================================================================

/**
 * Eligibility criteria for appointments
 */
export interface EligibilityCriteria {
  id: string;
  name: string;
  description: string;
  clinicId: string;
  conditions: {
    ageRange?: { min: number; max: number };
    insuranceTypes?: string[];
    medicalHistory?: string[];
    appointmentTypes?: string[];
    timeRestrictions?: {
      minAdvanceHours: number;
      maxAdvanceDays: number;
    };
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Eligibility check result
 */
export interface EligibilityCheck {
  patientId: string;
  appointmentType: string;
  clinicId: string;
  requestedDate: Date;
  criteria: EligibilityCriteria[];
  result: {
    eligible: boolean;
    reasons: string[];
    restrictions: string[];
    recommendations: string[];
  };
  checkedAt: Date;
}

// ============================================================================
// REMINDER TYPES
// ============================================================================

/**
 * Reminder schedule
 */
export interface ReminderSchedule {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  reminderType: 'appointment_reminder' | 'follow_up' | 'prescription' | 'payment';
  scheduledFor: Date;
  status: 'scheduled' | 'sent' | 'failed' | 'cancelled';
  channels: ('email' | 'sms' | 'whatsapp' | 'push' | 'socket')[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  templateData: {
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    appointmentTime: string;
    location: string;
    clinicName: string;
    appointmentType?: string;
    notes?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Reminder rule configuration
 */
export interface ReminderRule {
  id: string;
  clinicId: string;
  reminderType: string;
  hoursBefore: number;
  isActive: boolean;
  channels: string[];
  template: string;
  conditions?: {
    appointmentType?: string[];
    priority?: string[];
    patientAge?: { min: number; max: number };
  };
}

/**
 * Reminder result
 */
export interface ReminderResult {
  success: boolean;
  reminderId: string;
  scheduledFor: Date;
  channels: string[];
  message?: string;
  error?: string;
}

// ============================================================================
// FOLLOW-UP TYPES
// ============================================================================

/**
 * Follow-up plan
 */
export interface FollowUpPlan {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  followUpType: 'routine' | 'urgent' | 'specialist' | 'therapy' | 'surgery';
  scheduledFor: Date;
  status: 'scheduled' | 'completed' | 'cancelled' | 'overdue';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  instructions: string;
  medications?: string[];
  tests?: string[];
  restrictions?: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Follow-up template
 */
export interface FollowUpTemplate {
  id: string;
  name: string;
  followUpType: string;
  daysAfter: number;
  instructions: string;
  isActive: boolean;
  clinicId?: string;
  conditions?: {
    appointmentType?: string[];
    diagnosis?: string[];
    ageRange?: { min: number; max: number };
  };
}

/**
 * Follow-up result
 */
export interface FollowUpResult {
  success: boolean;
  followUpId: string;
  scheduledFor: Date;
  message?: string;
  error?: string;
}

/**
 * Follow-up reminder
 */
export interface FollowUpReminder {
  id: string;
  followUpId: string;
  patientId: string;
  reminderType: 'appointment' | 'medication' | 'test' | 'instruction';
  scheduledFor: Date;
  status: 'scheduled' | 'sent' | 'failed';
  message: string;
  channels: string[];
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * Appointment notification data
 */
export interface NotificationData {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  type:
    | 'reminder'
    | 'confirmation'
    | 'cancellation'
    | 'reschedule'
    | 'follow_up'
    | 'created'
    | 'updated';
  scheduledFor?: Date;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  channels: ('email' | 'sms' | 'whatsapp' | 'push' | 'socket')[];
  templateData: {
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    appointmentTime: string;
    location: string;
    clinicName: string;
    appointmentType?: string;
    notes?: string;
    rescheduleUrl?: string;
    cancelUrl?: string;
    changes?: Record<string, unknown>;
  };
}

/**
 * Notification result
 */
export interface NotificationResult {
  success: boolean;
  notificationId: string;
  sentChannels: string[];
  failedChannels: string[];
  errors?: string[];
  scheduledFor?: Date;
}

/**
 * Notification template
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  type: string;
  channels: string[];
  subject?: string;
  body: string;
  isActive: boolean;
  clinicId?: string;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

/**
 * Appointment metrics
 */
export interface AppointmentMetrics {
  totalAppointments: number;
  appointmentsByStatus: Record<string, number>;
  appointmentsByType: Record<string, number>;
  appointmentsByPriority: Record<string, number>;
  averageDuration: number;
  noShowRate: number;
  completionRate: number;
  averageWaitTime: number;
  queueEfficiency: number;
  patientSatisfaction: number;
  revenue: number;
  costPerAppointment: number;
}

/**
 * Doctor metrics
 */
export interface DoctorMetrics {
  doctorId: string;
  doctorName: string;
  totalAppointments: number;
  completedAppointments: number;
  averageRating: number;
  noShowRate: number;
  averageDuration: number;
  patientSatisfaction: number;
  revenue: number;
  efficiency: number;
}

/**
 * Clinic metrics
 */
export interface ClinicMetrics {
  clinicId: string;
  clinicName: string;
  totalAppointments: number;
  totalDoctors: number;
  totalPatients: number;
  averageWaitTime: number;
  queueEfficiency: number;
  patientSatisfaction: number;
  revenue: number;
  costPerAppointment: number;
  utilizationRate: number;
}

/**
 * Time slot metrics
 */
export interface TimeSlotMetrics {
  timeSlot: string;
  totalAppointments: number;
  completedAppointments: number;
  noShowRate: number;
  averageDuration: number;
  efficiency: number;
}

/**
 * Analytics filter
 */
export interface AnalyticsFilter {
  clinicId?: string;
  doctorId?: string;
  patientId?: string;
  startDate: Date;
  endDate: Date;
  appointmentType?: string;
  status?: string;
  priority?: string;
}

/**
 * Analytics result
 */
export interface AnalyticsResult {
  success: boolean;
  data?: unknown;
  error?: string;
  generatedAt: Date;
  filters: AnalyticsFilter;
}

// ============================================================================
// VIDEO CONSULTATION TYPES
// ============================================================================

/**
 * Jitsi room configuration
 */
export interface JitsiRoomConfig {
  roomName: string;
  meetingUrl?: string;
  moderatorPassword?: string;
  participantPassword?: string;
  encryptionKey?: string;
  recordingEnabled: boolean;
  maxParticipants: number;
  appointmentId?: string;
  isSecure?: boolean;
  enableRecording?: boolean;
  hipaaCompliant?: boolean;
}

/**
 * Video consultation session
 */
export interface VideoConsultationSession {
  appointmentId: string;
  roomName: string;
  status: 'pending' | 'started' | 'ended' | 'cancelled';
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  meetingNotes?: string | undefined;
  recordingUrl?: string | undefined;
  technicalIssues?: Array<{
    issueType: string;
    description: string;
    reportedBy: string;
    timestamp: Date;
  }>;
  participants: Array<{
    userId: string;
    userRole: 'patient' | 'doctor';
    patientId?: string;
    doctorId?: string;
    joinedAt?: Date;
    leftAt?: Date;
    duration?: number;
    issues?: string[];
  }>;
  hipaaAuditLog: Array<{
    action: string;
    timestamp: Date;
    userId: string;
    details: Record<string, unknown>;
  }>;
}

/**
 * Video call information
 */
export interface VideoCall {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  startTime?: string | undefined;
  endTime?: string | undefined;
  duration?: number | undefined;
  recordingUrl?: string | undefined;
  meetingUrl?: string | undefined;
  participants: string[];
  settings: VideoCallSettings;
}

/**
 * Video call settings
 */
export interface VideoCallSettings {
  maxParticipants: number;
  recordingEnabled: boolean;
  screenSharingEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
  autoRecord: boolean;
}

// ============================================================================
// QUEUE TYPES (Additional)
// ============================================================================

/**
 * Queue entry data
 */
export interface QueueEntryData {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  status: string;
  priority: number;
  checkedInAt?: string;
  estimatedWaitTime?: number;
  position?: number;
  confirmedAt?: string;
  startedAt?: string;
  actualWaitTime?: number;
  locationId?: string;
  emergencyAt?: string;
}

// ============================================================================
// LOCATION TYPES
// ============================================================================

/**
 * Appointment location
 */
export interface AppointmentLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  phone: string;
  email?: string;
  type: 'clinic' | 'studio' | 'hospital' | 'outpatient';
  capacity: number;
  isActive: boolean;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  amenities: string[];
  operatingHours: {
    [key: string]: {
      open: string;
      close: string;
      isOpen: boolean;
    };
  };
}

/**
 * Location statistics
 */
export interface LocationStats {
  totalAppointments: number;
  totalDoctors: number;
  averageWaitTime: number;
  efficiency: number;
  utilization: number;
  patientSatisfaction: number;
}

/**
 * Appointment location doctor information (appointment-specific)
 * Note: This is different from LocationDoctor in clinic.types.ts
 * This includes appointment-specific fields like specialization, licenseNumber, experience, and rating
 * For basic doctor info in clinic locations, use LocationDoctor from clinic.types.ts
 */
export interface AppointmentLocationDoctor {
  id: string;
  name: string;
  specialization: string;
  licenseNumber?: string;
  experience: number;
  rating: number;
}

// ============================================================================
// CONFIRMATION TYPES
// ============================================================================

/**
 * QR code data for appointment confirmation
 */
export interface AppointmentQRCodeData {
  appointmentId: string;
  domain: string;
  timestamp: number;
  expiresAt: number;
  type: 'check-in' | 'confirmation';
}

/**
 * Confirmation result
 */
export interface ConfirmationResult {
  success: boolean;
  appointmentId: string;
  domain: string;
  confirmedAt: string;
  qrCode?: string;
  message?: string;
}

// ============================================================================
// WAITLIST TYPES
// ============================================================================

/**
 * Waitlist entry
 */
export interface WaitlistEntry {
  id: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  preferredDate: Date;
  preferredTime?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  reason: string;
  status: 'waiting' | 'notified' | 'scheduled' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  notifiedAt?: Date;
  scheduledAt?: Date;
}

/**
 * Waitlist metrics
 */
export interface WaitlistMetrics {
  totalEntries: number;
  entriesByPriority: Record<string, number>;
  entriesByStatus: Record<string, number>;
  averageWaitTime: number;
  notificationRate: number;
}

// ============================================================================
// COMMUNICATION TYPES
// ============================================================================

/**
 * Appointment socket message
 */
export interface AppointmentSocketMessage {
  type: 'queue_update' | 'appointment_status' | 'video_call' | 'notification';
  appointmentId: string;
  clinicId: string;
  userId: string;
  timestamp: string;
  data?: Record<string, string | number | boolean | null>;
}

/**
 * Queue update message
 */
export interface QueueUpdateMessage {
  appointmentId: string;
  position: number;
  estimatedWaitTime: number;
  status: 'waiting' | 'in_progress' | 'completed';
}

/**
 * Appointment status message
 */
export interface AppointmentStatusMessage {
  appointmentId: string;
  status: 'scheduled' | 'confirmed' | 'checked_in' | 'in_progress' | 'completed' | 'cancelled';
  message?: string;
}
