import type {
  User,
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
} from "./prisma.types";
import type { Role, Gender } from "../../../dtos/user.dto";

/**
 * User entity with all related entities included
 * @interface UserWithRelations
 * @description Extends the base User type with all possible related entities
 * @example
 * ```typescript
 * const userWithRelations: UserWithRelations = {
 *   id: '123',
 *   email: 'user@example.com',
 *   doctor: { id: '456', userId: '123' },
 *   patient: null,
 *   // ... other relations
 * };
 * ```
 */
export interface UserWithRelations extends User {
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
}

/**
 * User response DTO for API responses
 * @interface UserResponse
 * @description Standardized user data structure for API responses
 * @example
 * ```typescript
 * const userResponse: UserResponse = {
 *   id: '123',
 *   email: 'user@example.com',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   role: 'DOCTOR',
 *   isActive: true,
 *   createdAt: new Date(),
 *   updatedAt: new Date()
 * };
 * ```
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
}

/**
 * Prisma-specific error interface
 * @interface PrismaError
 * @description Extends Error with Prisma-specific error information
 * @example
 * ```typescript
 * try {
 *   await prisma.user.create({ data: userData });
 * } catch (error) {
 *   if (error instanceof PrismaError) {
 *     console.log('Prisma error code:', error.code);
 *   }
 * }
 * ```
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

/**
 * User with password field for authentication operations
 * @interface UserWithPassword
 * @description Extends User type with password field for auth operations
 * @example
 * ```typescript
 * const userWithPassword: UserWithPassword = {
 *   id: '123',
 *   email: 'user@example.com',
 *   password: 'hashedPassword',
 *   // ... other user fields
 * };
 * ```
 */
export interface UserWithPassword extends User {
  /** User's hashed password */
  password: string;
}

/**
 * User creation data interface for registration
 * @interface UserCreateData
 * @description Data structure for creating new users
 * @example
 * ```typescript
 * const userData: UserCreateData = {
 *   userid: 'uuid-123',
 *   email: 'user@example.com',
 *   password: 'hashedPassword',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   // ... other fields
 * };
 * ```
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
 * @interface UserSelectResult
 * @description Result structure for user database select operations
 * @example
 * ```typescript
 * const userResult: UserSelectResult = {
 *   id: '123',
 *   email: 'user@example.com',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   role: 'DOCTOR',
 *   isVerified: true,
 *   primaryClinicId: 'clinic-123',
 *   lastLogin: new Date(),
 *   createdAt: new Date()
 * };
 * ```
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
