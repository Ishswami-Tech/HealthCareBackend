import { Role } from '@core/types';
import { FastifyRequest } from 'fastify';

/**
 * Represents working hours for a specific day
 * @interface WorkingHours
 * @description Defines the start and end times for working hours
 * @example
 * ```typescript
 * const workingHours: WorkingHours = {
 *   start: "09:00",
 *   end: "17:00"
 * };
 * ```
 */
export interface WorkingHours {
  /** Start time in HH:MM format */
  readonly start: string;
  /** End time in HH:MM format */
  readonly end: string;
}

/**
 * Represents weekly working hours for a clinic location
 * @interface WeeklyWorkingHours
 * @description Defines working hours for each day of the week
 * @example
 * ```typescript
 * const weeklyHours: WeeklyWorkingHours = {
 *   monday: { start: "09:00", end: "17:00" },
 *   tuesday: { start: "09:00", end: "17:00" },
 *   wednesday: null, // Closed on Wednesday
 *   thursday: { start: "09:00", end: "17:00" },
 *   friday: { start: "09:00", end: "17:00" },
 *   saturday: { start: "10:00", end: "14:00" },
 *   sunday: null // Closed on Sunday
 * };
 * ```
 */
export interface WeeklyWorkingHours {
  /** Monday working hours */
  readonly monday?: WorkingHours | null;
  /** Tuesday working hours */
  readonly tuesday?: WorkingHours | null;
  /** Wednesday working hours */
  readonly wednesday?: WorkingHours | null;
  /** Thursday working hours */
  readonly thursday?: WorkingHours | null;
  /** Friday working hours */
  readonly friday?: WorkingHours | null;
  /** Saturday working hours */
  readonly saturday?: WorkingHours | null;
  /** Sunday working hours */
  readonly sunday?: WorkingHours | null;
}

/**
 * Represents a doctor at a specific clinic location
 * @interface LocationDoctor
 * @description Contains basic doctor information for location-specific operations
 * @example
 * ```typescript
 * const doctor: LocationDoctor = {
 *   id: "doctor-123",
 *   name: "Dr. John Smith",
 *   profilePicture: "https://example.com/avatar.jpg"
 * };
 * ```
 */
export interface LocationDoctor {
  /** Unique doctor identifier */
  readonly id: string;
  /** Doctor's full name */
  readonly name: string;
  /** Optional profile picture URL */
  readonly profilePicture?: string;
}

/**
 * Represents a clinic location with complete details
 * @interface ClinicLocation
 * @description Contains comprehensive information about a clinic location
 * @example
 * ```typescript
 * const location: ClinicLocation = {
 *   id: "location-123",
 *   locationId: "loc-456",
 *   name: "Downtown Medical Center",
 *   address: "123 Main St",
 *   city: "New York",
 *   state: "NY",
 *   country: "USA",
 *   zipCode: "10001",
 *   phone: "+1-555-0123",
 *   email: "downtown@clinic.com",
 *   timezone: "America/New_York",
 *   workingHours: weeklyHours,
 *   isActive: true,
 *   doctors: [doctor1, doctor2]
 * };
 * ```
 */
/**
 * Operating hours for a specific day
 * @interface DayOperatingHours
 */
export interface DayOperatingHours {
  /** Opening time in HH:MM format */
  readonly open: string;
  /** Closing time in HH:MM format */
  readonly close: string;
  /** Whether the location is open on this day */
  readonly isOpen: boolean;
}

/**
 * Weekly operating hours structure (alternative to WeeklyWorkingHours)
 * @interface OperatingHours
 */
export interface OperatingHours {
  readonly monday?: DayOperatingHours;
  readonly tuesday?: DayOperatingHours;
  readonly wednesday?: DayOperatingHours;
  readonly thursday?: DayOperatingHours;
  readonly friday?: DayOperatingHours;
  readonly saturday?: DayOperatingHours;
  readonly sunday?: DayOperatingHours;
}

/**
 * Location capacity information
 * @interface LocationCapacity
 */
export interface LocationCapacity {
  /** Maximum number of appointments per day */
  readonly maxAppointments: number;
  /** Maximum concurrent appointments */
  readonly maxConcurrent: number;
}

export interface ClinicLocation {
  /** Unique location identifier */
  readonly id: string;
  /** Location ID for external references */
  readonly locationId: string;
  /** Location name */
  readonly name: string;
  /** Street address */
  readonly address: string;
  /** City name */
  readonly city: string;
  /** State or province */
  readonly state: string;
  /** Country name */
  readonly country: string;
  /** Optional postal/zip code */
  readonly zipCode?: string;
  /** Optional phone number */
  readonly phone?: string;
  /** Optional email address */
  readonly email?: string;
  /** Timezone identifier */
  readonly timezone: string;
  /** Optional weekly working hours (standard format) */
  readonly workingHours?: WeeklyWorkingHours;
  /** Optional operating hours (alternative format with open/close/isOpen) */
  readonly operatingHours?: OperatingHours;
  /** Optional location capacity information */
  readonly capacity?: LocationCapacity;
  /** Whether the location is active */
  readonly isActive: boolean;
  /** Optional list of doctors at this location */
  readonly doctors?: LocationDoctor[];
}

/**
 * Represents QR code data for clinic check-ins
 * @interface QRCodeData
 * @description Contains data encoded in QR codes for patient check-ins
 * @example
 * ```typescript
 * const qrData: QRCodeData = {
 *   locationId: "location-123",
 *   clinicId: "clinic-456",
 *   timestamp: "2024-01-15T10:30:00Z"
 * };
 * ```
 */
export interface QRCodeData {
  /** Location identifier */
  readonly locationId: string;
  /** Clinic identifier */
  readonly clinicId: string;
  /** Timestamp when QR code was generated */
  readonly timestamp: string;
}

/**
 * Represents clinic context for multi-tenant operations
 * @interface ClinicContext
 * @description Comprehensive clinic context information for multi-tenant operations
 * This is the single source of truth for ClinicContext across the application
 * @example
 * ```typescript
 * const context: ClinicContext = {
 *   clinicId: "clinic-123",
 *   clinicName: "Downtown Medical Center",
 *   identifier: "downtown-clinic",
 *   subdomain: "downtown",
 *   appName: "Downtown Medical",
 *   isActive: true,
 *   isValid: true
 * };
 * ```
 */
export interface ClinicContext {
  /** Clinic ID */
  readonly clinicId: string;
  /** Clinic name */
  readonly clinicName: string;
  /** Optional clinic identifier string (unique identifier) */
  readonly identifier?: string;
  /** Optional subdomain */
  readonly subdomain?: string;
  /** Optional application name */
  readonly appName?: string;
  /** Optional location ID */
  readonly locationId?: string;
  /** Optional location name */
  readonly locationName?: string;
  /** Optional user ID in context */
  readonly userId?: string;
  /** Optional user role in context */
  readonly userRole?: string;
  /** Optional permissions array */
  readonly permissions?: string[];
  /** Whether the clinic is active */
  readonly isActive?: boolean;
  /** Whether the context is valid */
  readonly isValid?: boolean;
  /** Optional list of location IDs */
  readonly locations?: string[];
  /** Optional clinic features */
  readonly features?: string[];
  /** Optional clinic settings */
  readonly settings?: Record<string, string | number | boolean>;
  /** Optional metadata */
  readonly metadata?: {
    requestId?: string;
    timestamp?: Date;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
    [key: string]: unknown;
  };
  /** Optional timestamp */
  readonly timestamp?: Date;
  /** Additional clinic properties for extensibility */
  readonly [key: string]: unknown;
}

/**
 * Represents an authenticated request with clinic context (clinic-specific)
 * @interface ClinicAuthenticatedRequest
 * @description Extends FastifyRequest with user and clinic context information for clinic operations
 * @example
 * ```typescript
 * const request: ClinicAuthenticatedRequest = {
 *   user: authenticatedUser,
 *   clinicContext: clinicContext,
 *   // ... other FastifyRequest properties
 * };
 * ```
 */
export interface ClinicAuthenticatedRequest extends FastifyRequest {
  /** Authenticated user information */
  readonly user: import('./guard.types').AuthenticatedUser;
  /** Optional clinic context */
  readonly clinicContext?: ClinicContext;
}

/**
 * Represents a user within a clinic system
 * @interface ClinicUser
 * @description Contains user profile information for clinic operations
 * @example
 * ```typescript
 * const clinicUser: ClinicUser = {
 *   id: "user-123",
 *   email: "nurse@clinic.com",
 *   firstName: "Jane",
 *   lastName: "Doe",
 *   role: Role.NURSE,
 *   isVerified: true,
 *   createdAt: new Date("2024-01-01")
 * };
 * ```
 */
export interface ClinicUser {
  /** Unique user identifier */
  readonly id: string;
  /** User email address */
  readonly email: string;
  /** Optional first name */
  readonly firstName?: string;
  /** Optional last name */
  readonly lastName?: string;
  /** User role */
  readonly role: Role;
  /** Whether the user is verified */
  readonly isVerified: boolean;
  /** User creation timestamp */
  readonly createdAt: Date;
}

/**
 * Represents basic clinic information
 * @interface ClinicInfo
 * @description Contains essential clinic identification and status information
 * @example
 * ```typescript
 * const clinicInfo: ClinicInfo = {
 *   id: "clinic-123",
 *   name: "Downtown Medical Center",
 *   appName: "Downtown Medical",
 *   isActive: true,
 *   createdAt: new Date("2024-01-01")
 * };
 * ```
 */
export interface ClinicInfo {
  /** Unique clinic identifier */
  readonly id: string;
  /** Clinic name */
  readonly name: string;
  /** Application name */
  readonly appName: string;
  /** Whether the clinic is active */
  readonly isActive: boolean;
  /** Clinic creation timestamp */
  readonly createdAt: Date;
  /** Optional clinic code */
  readonly code?: string;
  /** Optional clinic type */
  readonly type?: 'hospital' | 'clinic' | 'diagnostic' | 'specialty';
  /** Optional clinic status */
  readonly status?: 'active' | 'inactive' | 'suspended';
  /** Optional clinic locations */
  readonly locations?: ClinicLocation[];
  /** Optional clinic settings */
  readonly settings?: ClinicSettings;
  /** Optional subscription information */
  readonly subscription?: {
    plan: 'basic' | 'professional' | 'enterprise';
    maxUsers: number;
    maxPatients: number;
    expiresAt: Date;
  };
  /** Optional metadata */
  readonly metadata?: {
    createdAt: Date;
    updatedAt: Date;
    ownerId: string;
    timezone: string;
    locale: string;
  };
}

/**
 * Clinic settings configuration
 */
export interface ClinicSettings {
  appointmentSettings: {
    defaultDuration: number;
    bufferTime: number;
    maxAdvanceBooking: number; // days
    allowOnlineBooking: boolean;
    requireApproval: boolean;
  };
  notificationSettings: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    reminderHours: number[];
  };
  billingSettings: {
    currency: string;
    taxRate: number;
    paymentMethods: string[];
    invoicePrefix: string;
  };
  securitySettings: {
    mfaRequired: boolean;
    sessionTimeout: number; // minutes
    passwordPolicy: {
      minLength: number;
      requireSpecialChars: boolean;
      requireNumbers: boolean;
      expirationDays: number;
    };
  };
  integrationSettings: {
    enabledIntegrations: string[];
    webhookUrl?: string;
    apiKeys: Record<string, string>;
  };
}

/**
 * User clinic association
 */
export interface UserClinicAssociation {
  userId: string;
  clinicId: string;
  role: string;
  permissions: string[];
  locations: string[]; // Location IDs user has access to
  restrictions: {
    timeRestricted: boolean;
    ipRestricted: boolean;
    allowedIPs: string[];
    workingHours: {
      start: string; // HH:mm
      end: string; // HH:mm
      days: number[]; // 0-6, Sunday = 0
    };
  };
  status: 'active' | 'inactive' | 'suspended';
  metadata: {
    assignedAt: Date;
    assignedBy: string;
    lastLogin?: Date;
    lastActivity?: Date;
  };
}

/**
 * Base clinic entity structure
 * @interface ClinicBase
 * @description Core clinic entity properties
 */
export interface ClinicBase {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly email: string;
  readonly subdomain: string;
  readonly app_name: string;
  readonly logo?: string;
  readonly website?: string;
  readonly description?: string;
  readonly timezone: string;
  readonly currency: string;
  readonly language: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Clinic with location relation
 * @interface ClinicWithLocation
 * @description Clinic entity including main location
 */
export interface ClinicWithLocation extends ClinicBase {
  readonly mainLocation: {
    readonly id: string;
    readonly locationId: string;
    readonly name: string;
    readonly address: string;
    readonly city: string;
    readonly state: string;
    readonly country: string;
    readonly zipCode: string;
    readonly phone: string;
    readonly email: string;
    readonly timezone: string;
    readonly workingHours: string;
    readonly isActive: boolean;
    readonly clinicId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
}

/**
 * Input for creating a clinic
 * @interface ClinicCreateInput
 */
export interface ClinicCreateInput {
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly email: string;
  readonly subdomain: string;
  readonly app_name: string;
  readonly logo?: string;
  readonly website?: string;
  readonly description?: string;
  readonly timezone: string;
  readonly currency: string;
  readonly language: string;
  readonly isActive?: boolean;
  readonly createdBy: string;
}

/**
 * Input for updating a clinic
 * @interface ClinicUpdateInput
 */
export interface ClinicUpdateInput {
  readonly name?: string;
  readonly address?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly subdomain?: string;
  readonly app_name?: string;
  readonly logo?: string;
  readonly website?: string;
  readonly description?: string;
  readonly timezone?: string;
  readonly currency?: string;
  readonly language?: string;
  readonly isActive?: boolean;
  readonly updatedAt?: Date;
}

/**
 * Input for querying clinics
 * @interface ClinicWhereInput
 */
export interface ClinicWhereInput {
  readonly id?: string;
  readonly name?: string;
  readonly subdomain?: string;
  readonly isActive?: boolean;
}

/**
 * Clinic response DTO
 * @interface ClinicResponseDto
 */
export interface ClinicResponseDto {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly phone: string;
  readonly email: string;
  readonly subdomain: string;
  readonly app_name: string;
  readonly logo?: string;
  readonly website?: string;
  readonly description?: string;
  readonly timezone: string;
  readonly currency: string;
  readonly language: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly mainLocation?: {
    readonly id: string;
    readonly locationId: string;
    readonly name: string;
    readonly address: string;
    readonly city: string;
    readonly state: string;
    readonly country: string;
    readonly zipCode: string;
    readonly phone: string;
    readonly email: string;
    readonly timezone: string;
    readonly workingHours: string;

    readonly isActive: boolean;
    readonly clinicId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
  readonly locations?: Array<{
    readonly id: string;
    readonly locationId: string;
    readonly name: string;
    readonly address: string;
    readonly city: string;
    readonly state: string;
    readonly country: string;
    readonly zipCode: string;
    readonly phone: string;
    readonly email: string;
    readonly timezone: string;
    readonly workingHours: string;
    readonly isActive: boolean;
    readonly clinicId: string;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }>;
}

/**
 * Base clinic location entity
 * @interface ClinicLocationBase
 */
export interface ClinicLocationBase {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly zipCode: string;
  readonly phone: string;
  readonly email: string;
  readonly timezone: string;
  readonly workingHours: string;
  readonly isActive: boolean;
  readonly clinicId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Clinic location with doctors relation
 * @interface ClinicLocationWithDoctors
 */
export interface ClinicLocationWithDoctors extends ClinicLocationBase {
  readonly doctorClinic: Array<{
    readonly id: string;
    readonly doctorId: string;
    readonly clinicId: string;
    readonly doctor: {
      readonly id: string;
      readonly user: {
        readonly id: string;
        readonly name: string;
        readonly email: string;
      };
    };
  }>;
}

/**
 * Input for creating a clinic location
 * @interface ClinicLocationCreateInput
 */
export interface ClinicLocationCreateInput {
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly zipCode: string;
  readonly phone: string;
  readonly email: string;
  readonly timezone: string;
  readonly workingHours?: string;
  readonly isActive?: boolean;
  readonly clinicId: string;
  readonly locationId: string;
}

/**
 * Input for updating a clinic location
 * @interface ClinicLocationUpdateInput
 */
export interface ClinicLocationUpdateInput {
  readonly name?: string;
  readonly address?: string;
  readonly city?: string;
  readonly state?: string;
  readonly country?: string;
  readonly zipCode?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly timezone?: string;
  readonly workingHours?: string;
  readonly isActive?: boolean;
  readonly updatedAt?: Date;
}

/**
 * Input for querying clinic locations
 * @interface ClinicLocationWhereInput
 */
export interface ClinicLocationWhereInput {
  readonly id?: string;
  readonly clinicId?: string;
  readonly name?: string;
  readonly isActive?: boolean;
}

/**
 * Clinic location response DTO
 * @interface ClinicLocationResponseDto
 */
export interface ClinicLocationResponseDto {
  readonly id: string;
  readonly locationId: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly zipCode: string;
  readonly phone: string;
  readonly email: string;
  readonly timezone: string;
  readonly workingHours: string;
  readonly isActive: boolean;
  readonly clinicId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Base clinic user entity
 * @interface ClinicUserBase
 */
export interface ClinicUserBase {
  readonly id: string;
  readonly userId: string;
  readonly clinicId: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Clinic user with user relation
 * @interface ClinicUserWithUser
 */
export interface ClinicUserWithUser extends ClinicUserBase {
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly phone?: string;
    readonly isActive: boolean;
  };
}

/**
 * Input for creating a clinic user
 * @interface ClinicUserCreateInput
 */
export interface ClinicUserCreateInput {
  readonly userId: string;
  readonly clinicId: string;
  readonly role: string;
  readonly isActive?: boolean;
}

/**
 * Input for updating a clinic user
 * @interface ClinicUserUpdateInput
 */
export interface ClinicUserUpdateInput {
  readonly role?: string;
  readonly isActive?: boolean;
  readonly updatedAt?: Date;
}

/**
 * Input for querying clinic users
 * @interface ClinicUserWhereInput
 */
export interface ClinicUserWhereInput {
  readonly id?: string;
  readonly userId?: string;
  readonly clinicId?: string;
  readonly role?: string;
  readonly isActive?: boolean;
}

/**
 * Clinic user response DTO
 * @interface ClinicUserResponseDto
 */
export interface ClinicUserResponseDto {
  readonly id: string;
  readonly userId: string;
  readonly clinicId: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly user?: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly phone?: string;
    readonly isActive: boolean;
  };
}
