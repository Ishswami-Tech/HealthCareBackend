/**
 * User Types - Centralized user-related type definitions
 * All user types should be defined here, not in database module files
 */

import type { Role } from './rbac.types';
import type { Gender } from '@dtos/user.dto';
import type { QueryOptions } from './database.types';

// Import entity types from consolidated database.types
import type {
  Doctor,
  Patient,
  Receptionist,
  ClinicAdmin,
  SuperAdmin,
  Pharmacist,
  Therapist,
  LabTechnician,
  FinanceBilling,
  SupportStaff,
  Nurse,
  Counselor,
  LocationHead,
} from './database.types';
// Note: PrismaUser type is not needed - UserBase interface below provides all needed fields

// Explicit base User interface to avoid Prisma's 'any' in union types
// This interface explicitly defines all User fields without using Prisma types
// to avoid 'any' in union types when used in return type annotations
export interface UserBase {
  id: string;
  userid: string;
  email: string;
  password: string;
  name: string;
  age: number;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  role: string;
  profilePicture?: string | null;
  gender?: string | null;
  dateOfBirth?: Date | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zipCode?: string | null;
  emergencyContact?: string | null;
  isVerified: boolean;
  lastLogin?: Date | null;
  lastLoginIP?: string | null;
  lastLoginDevice?: string | null;
  createdAt: Date;
  updatedAt: Date;
  passwordChangedAt?: Date | null;
  googleId?: string | null;
  facebookId?: string | null;
  appleId?: string | null;
  appName?: string | null;
  medicalConditions?: string | null;
  prakriti?: string | null;
  vikriti?: string | null;
  doshaImbalances?: Record<string, unknown> | null;
  agni?: string | null;
  dinacharya?: string | null;
  dietaryRestrictionsJson?: Record<string, unknown> | null;
  lifestyleFactors?: Record<string, unknown> | null;
  seasonalPatterns?: Record<string, unknown> | null;
  primaryClinicId?: string | null;
}

/**
 * User entity with all related entities included
 */
export interface UserWithRelations extends UserBase {
  /** Doctor profile if user is a doctor */
  doctor?: Doctor | null;
  /** Patient profile if user is a patient */
  patient?: Patient | null;
  /** Receptionist profiles if user is a receptionist */
  receptionists?: Receptionist[];
  /** Clinic admin profiles if user is a clinic admin */
  clinicAdmins?: ClinicAdmin[];
  /** Super admin profile if user is a super admin */
  superAdmin?: SuperAdmin | null;
  /** Pharmacist profile if user is a pharmacist */
  pharmacist?: Pharmacist | null;
  /** Therapist profile if user is a therapist */
  therapist?: Therapist | null;
  /** Lab technician profile if user is a lab technician */
  labTechnician?: LabTechnician | null;
  /** Finance billing profile if user is in finance */
  financeBilling?: FinanceBilling | null;
  /** Support staff profile if user is support staff */
  supportStaff?: SupportStaff | null;
  /** Nurse profile if user is a nurse */
  nurse?: Nurse | null;
  /** Counselor profile if user is a counselor */
  counselor?: Counselor | null;
  /** Location head profile if user is a location head */
  locationHead?: LocationHead | null;
}

/**
 * User response DTO for API responses
 */
export interface UserResponse {
  /** Unique user identifier */
  id: string;
  /** User's email address */
  email: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** User's phone number */
  phone?: string | null;
  /** User's date of birth */
  dateOfBirth?: string | null;
  /** User's gender */
  gender?: string | null;
  /** User's address */
  address?: string | null;
  /** User's city */
  city?: string | null;
  /** User's state */
  state?: string | null;
  /** User's country */
  country?: string | null;
  /** User's zip code */
  zipCode?: string | null;
  /** User's role in the system */
  role: string;
  /** Whether the user account is active */
  isActive: boolean;
  /** Last login timestamp */
  lastLogin?: Date | null;
  /** Account creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Doctor profile if user is a doctor */
  doctor?: Doctor | null;
  /** Patient profile if user is a patient */
  patient?: Patient | null;
  /** Receptionist profiles if user is a receptionist */
  receptionists?: Receptionist[];
  /** Clinic admin profiles if user is a clinic admin */
  clinicAdmins?: ClinicAdmin[];
  /** Super admin profile if user is a super admin */
  superAdmin?: SuperAdmin | null;
  /** Pharmacist profile if user is a pharmacist */
  pharmacist?: Pharmacist | null;
  /** Therapist profile if user is a therapist */
  therapist?: Therapist | null;
  /** Lab technician profile if user is a lab technician */
  labTechnician?: LabTechnician | null;
  /** Finance billing profile if user is in finance */
  financeBilling?: FinanceBilling | null;
  /** Support staff profile if user is support staff */
  supportStaff?: SupportStaff | null;
  /** Nurse profile if user is a nurse */
  nurse?: Nurse | null;
  /** Counselor profile if user is a counselor */
  counselor?: Counselor | null;
  /** Location head profile if user is a location head */
  locationHead?: LocationHead | null;
}

/**
 * User with password field for authentication operations
 */
export interface UserWithPassword extends UserBase {
  /** User's hashed password */
  password: string;
}

/**
 * User creation data interface for registration
 */
export interface UserCreateData {
  /** Unique user identifier */
  userid: string;
  /** User's full name */
  name: string;
  /** User's age */
  age: number;
  /** User's email address */
  email: string;
  /** User's hashed password */
  password: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** User's phone number */
  phone?: string;
  /** User's role in the system */
  role?: Role;
  /** User's gender */
  gender?: Gender;
  /** User's date of birth */
  dateOfBirth?: string;
  /** User's address */
  address?: string;
  /** Primary clinic ID */
  primaryClinicId?: string;
  /** Google OAuth ID */
  googleId?: string;
}

/**
 * User select result for database queries
 */
export interface UserSelectResult {
  /** Unique user identifier */
  id: string;
  /** User's email address */
  email: string;
  /** User's first name */
  firstName: string;
  /** User's last name */
  lastName: string;
  /** User's role in the system */
  role: string;
  /** Whether user email is verified */
  isVerified: boolean;
  /** Primary clinic ID */
  primaryClinicId: string | null;
  /** Last login timestamp */
  lastLogin?: Date | null;
  /** Account creation timestamp */
  createdAt: Date;
}

/**
 * User with Profile (extended user with related entities)
 */
export interface UserWithProfile extends UserBase {
  profile?: unknown;
  appointments?: unknown[];
  medicalHistory?: unknown[];
}

/**
 * User Search Options (extends QueryOptions with user-specific filters)
 */
export interface UserSearchOptions extends QueryOptions {
  searchTerm?: string;
  role?: string;
  status?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  includeProfile?: boolean;
  includeAppointments?: boolean;
  includeMedicalHistory?: boolean;
}

/**
 * Prisma-specific error interface
 */
export interface PrismaError extends Error {
  /** Prisma error code */
  code?: string;
  /** Additional error metadata */
  meta?: {
    /** Database constraint targets */
    target?: string[];
    /** Error cause information */
    cause?: string;
  };
}
