import { Role } from "../../infrastructure/database/prisma/prisma.types";
import { FastifyRequest } from "fastify";

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
  /** Optional weekly working hours */
  readonly workingHours?: WeeklyWorkingHours;
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
 * @description Contains clinic identification and validation information
 * @example
 * ```typescript
 * const context: ClinicContext = {
 *   identifier: "downtown-clinic",
 *   clinicId: "clinic-123",
 *   subdomain: "downtown",
 *   appName: "Downtown Medical",
 *   isValid: true
 * };
 * ```
 */
export interface ClinicContext {
  /** Clinic identifier string */
  readonly identifier: string;
  /** Optional clinic ID */
  readonly clinicId?: string;
  /** Optional subdomain */
  readonly subdomain?: string;
  /** Optional application name */
  readonly appName?: string;
  /** Whether the context is valid */
  readonly isValid: boolean;
}

/**
 * Represents an authenticated user in the clinic system
 * @interface AuthenticatedUser
 * @description Contains user authentication and role information
 * @example
 * ```typescript
 * const user: AuthenticatedUser = {
 *   sub: "user-123",
 *   email: "doctor@clinic.com",
 *   role: Role.DOCTOR,
 *   clinicId: "clinic-456",
 *   clinicIdentifier: "downtown-clinic"
 * };
 * ```
 */
export interface AuthenticatedUser {
  /** User subject identifier */
  readonly sub: string;
  /** User email address */
  readonly email: string;
  /** User role */
  readonly role: Role;
  /** Optional clinic ID */
  readonly clinicId?: string;
  /** Optional clinic identifier */
  readonly clinicIdentifier?: string;
}

/**
 * Represents an authenticated request with clinic context
 * @interface AuthenticatedRequest
 * @description Extends FastifyRequest with user and clinic context information
 * @example
 * ```typescript
 * const request: AuthenticatedRequest = {
 *   user: authenticatedUser,
 *   clinicContext: clinicContext,
 *   // ... other FastifyRequest properties
 * };
 * ```
 */
export interface AuthenticatedRequest extends FastifyRequest {
  /** Authenticated user information */
  readonly user: AuthenticatedUser;
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
}
