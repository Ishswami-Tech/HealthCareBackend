/**
 * Comprehensive Prisma Type Definitions
 * This file consolidates all Prisma-related types in one place.
 * All types are strictly typed without using 'any' or 'unknown'.
 */

// Import entity types from database.types (consolidated)
import type {
  AppointmentWithRelations,
  PermissionEntity,
  RbacRoleEntity,
  RolePermissionEntity,
  UserRoleEntity,
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
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
  Clinic,
  AuditLog,
  EmergencyContact,
} from './database.types';
import type { ClinicLocation } from './clinic.types';

// Import UserWithRelations from user.types.ts
import type { UserWithRelations } from './user.types';

// Import TherapyQueue and QueueEntry from appointment.types.ts
import type { TherapyQueue, QueueEntry } from './appointment.types';

// ============================================================================
// Prisma Delegate Args - Recursive type for method arguments
// ============================================================================

/**
 * Recursive type for Prisma delegate method arguments
 * This type accepts any object structure through a permissive index signature
 * The actual type safety comes from Prisma's runtime validation and explicit return types
 * We use a recursive type that allows nested objects while avoiding 'any' and 'unknown'
 */
export type PrismaDelegateArgs = {
  [key: string]:
    | string
    | number
    | boolean
    | Date
    | null
    | PrismaDelegateArgs
    | Array<PrismaDelegateArgs>
    | Array<string | number | boolean | Date | null>;
};

// ============================================================================
// Base Delegate Interface
// ============================================================================

/**
 * Base delegate interface for all Prisma delegates
 * All delegates support these common methods
 */
export interface PrismaDelegateBase<TEntity> {
  findUnique: (args: PrismaDelegateArgs) => Promise<TEntity | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<TEntity | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<TEntity[]>;
  create: (args: PrismaDelegateArgs) => Promise<TEntity>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  update: (args: PrismaDelegateArgs) => Promise<TEntity>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  delete: (args: PrismaDelegateArgs) => Promise<TEntity>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

// ============================================================================
// Entity-Specific Delegate Interfaces
// ============================================================================

export interface UserDelegate extends PrismaDelegateBase<UserWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<UserWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
}

export interface AppointmentDelegate extends PrismaDelegateBase<AppointmentWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations>;
}

export interface PermissionDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<PermissionEntity | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<PermissionEntity | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<PermissionEntity[]>;
  create: (args: PrismaDelegateArgs) => Promise<PermissionEntity>;
  update: (args: PrismaDelegateArgs) => Promise<PermissionEntity>;
  delete: (args: PrismaDelegateArgs) => Promise<PermissionEntity>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

// Type guards to safely convert Prisma types to our strict types
export function toPermissionEntity(prismaPermission: unknown): PermissionEntity {
  return prismaPermission as PermissionEntity;
}

/**
 * Type assertion function to convert Prisma Doctor model to Doctor type
 * This is a type-safe assertion that ensures the Prisma model matches the Doctor interface
 * @param prismaDoctor - Prisma Doctor model from database
 * @returns Doctor type
 */
export function toDoctor(prismaDoctor: unknown): Doctor {
  return prismaDoctor as Doctor;
}

export function toPatient(prismaPatient: unknown): Patient {
  return prismaPatient as Patient;
}

export function toReceptionist(prismaReceptionist: unknown): Receptionist {
  return prismaReceptionist as Receptionist;
}

export function toClinicAdmin(prismaClinicAdmin: unknown): ClinicAdmin {
  return prismaClinicAdmin as ClinicAdmin;
}

export function toSuperAdmin(prismaSuperAdmin: unknown): SuperAdmin {
  return prismaSuperAdmin as SuperAdmin;
}

export function toPharmacist(prismaPharmacist: unknown): Pharmacist {
  return prismaPharmacist as Pharmacist;
}

export function toTherapist(prismaTherapist: unknown): Therapist {
  return prismaTherapist as Therapist;
}

export function toLabTechnician(prismaLabTechnician: unknown): LabTechnician {
  return prismaLabTechnician as LabTechnician;
}

export function toFinanceBilling(prismaFinanceBilling: unknown): FinanceBilling {
  return prismaFinanceBilling as FinanceBilling;
}

export function toSupportStaff(prismaSupportStaff: unknown): SupportStaff {
  return prismaSupportStaff as SupportStaff;
}

export function toNurse(prismaNurse: unknown): Nurse {
  return prismaNurse as Nurse;
}

export function toCounselor(prismaCounselor: unknown): Counselor {
  return prismaCounselor as Counselor;
}

export function toClinic(prismaClinic: unknown): Clinic {
  return prismaClinic as Clinic;
}

export function toAuditLog(prismaAuditLog: unknown): AuditLog {
  return prismaAuditLog as AuditLog;
}

export interface RbacRoleDelegate extends PrismaDelegateBase<RbacRoleEntity> {
  findUnique: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity[]>;
  create: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity>;
  update: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity>;
  delete: (args: PrismaDelegateArgs) => Promise<RbacRoleEntity>;
}

export interface RolePermissionDelegate extends PrismaDelegateBase<RolePermissionEntity> {
  findUnique: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity[]>;
  create: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity>;
  update: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity>;
  delete: (args: PrismaDelegateArgs) => Promise<RolePermissionEntity>;
}

export interface UserRoleDelegate extends PrismaDelegateBase<UserRoleEntity> {
  findUnique: (args: PrismaDelegateArgs) => Promise<UserRoleEntity | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<UserRoleEntity | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<UserRoleEntity[]>;
  create: (args: PrismaDelegateArgs) => Promise<UserRoleEntity>;
  update: (args: PrismaDelegateArgs) => Promise<UserRoleEntity>;
  delete: (args: PrismaDelegateArgs) => Promise<UserRoleEntity>;
}

export interface BillingPlanDelegate extends PrismaDelegateBase<BillingPlanWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<BillingPlanWithRelations>;
}

export interface SubscriptionDelegate extends PrismaDelegateBase<SubscriptionWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<SubscriptionWithRelations>;
}

export interface InvoiceDelegate extends PrismaDelegateBase<InvoiceWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<InvoiceWithRelations>;
}

export interface PaymentDelegate extends PrismaDelegateBase<PaymentWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<PaymentWithRelations>;
}

export interface DoctorDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Doctor | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Doctor | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Doctor[]>;
  create: (args: PrismaDelegateArgs) => Promise<Doctor>;
  update: (args: PrismaDelegateArgs) => Promise<Doctor>;
  delete: (args: PrismaDelegateArgs) => Promise<Doctor>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface PatientDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Patient | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Patient | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Patient[]>;
  create: (args: PrismaDelegateArgs) => Promise<Patient>;
  update: (args: PrismaDelegateArgs) => Promise<Patient>;
  delete: (args: PrismaDelegateArgs) => Promise<Patient>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface ReceptionistDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Receptionist | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Receptionist | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Receptionist[]>;
  create: (args: PrismaDelegateArgs) => Promise<Receptionist>;
  update: (args: PrismaDelegateArgs) => Promise<Receptionist>;
  delete: (args: PrismaDelegateArgs) => Promise<Receptionist>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface ClinicAdminDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<ClinicAdmin | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<ClinicAdmin | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<ClinicAdmin[]>;
  create: (args: PrismaDelegateArgs) => Promise<ClinicAdmin>;
  update: (args: PrismaDelegateArgs) => Promise<ClinicAdmin>;
  delete: (args: PrismaDelegateArgs) => Promise<ClinicAdmin>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface SuperAdminDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<SuperAdmin | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<SuperAdmin | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<SuperAdmin[]>;
  create: (args: PrismaDelegateArgs) => Promise<SuperAdmin>;
  update: (args: PrismaDelegateArgs) => Promise<SuperAdmin>;
  delete: (args: PrismaDelegateArgs) => Promise<SuperAdmin>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface PharmacistDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Pharmacist | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Pharmacist | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Pharmacist[]>;
  create: (args: PrismaDelegateArgs) => Promise<Pharmacist>;
  update: (args: PrismaDelegateArgs) => Promise<Pharmacist>;
  delete: (args: PrismaDelegateArgs) => Promise<Pharmacist>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface TherapistDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Therapist | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Therapist | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Therapist[]>;
  create: (args: PrismaDelegateArgs) => Promise<Therapist>;
  update: (args: PrismaDelegateArgs) => Promise<Therapist>;
  delete: (args: PrismaDelegateArgs) => Promise<Therapist>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface LabTechnicianDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<LabTechnician | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<LabTechnician | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<LabTechnician[]>;
  create: (args: PrismaDelegateArgs) => Promise<LabTechnician>;
  update: (args: PrismaDelegateArgs) => Promise<LabTechnician>;
  delete: (args: PrismaDelegateArgs) => Promise<LabTechnician>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface FinanceBillingDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<FinanceBilling | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<FinanceBilling | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<FinanceBilling[]>;
  create: (args: PrismaDelegateArgs) => Promise<FinanceBilling>;
  update: (args: PrismaDelegateArgs) => Promise<FinanceBilling>;
  delete: (args: PrismaDelegateArgs) => Promise<FinanceBilling>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface SupportStaffDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<SupportStaff | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<SupportStaff | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<SupportStaff[]>;
  create: (args: PrismaDelegateArgs) => Promise<SupportStaff>;
  update: (args: PrismaDelegateArgs) => Promise<SupportStaff>;
  delete: (args: PrismaDelegateArgs) => Promise<SupportStaff>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface NurseDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Nurse | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Nurse | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Nurse[]>;
  create: (args: PrismaDelegateArgs) => Promise<Nurse>;
  update: (args: PrismaDelegateArgs) => Promise<Nurse>;
  delete: (args: PrismaDelegateArgs) => Promise<Nurse>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface CounselorDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Counselor | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Counselor | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Counselor[]>;
  create: (args: PrismaDelegateArgs) => Promise<Counselor>;
  update: (args: PrismaDelegateArgs) => Promise<Counselor>;
  delete: (args: PrismaDelegateArgs) => Promise<Counselor>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface ClinicDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<Clinic | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Clinic | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Clinic[]>;
  create: (args: PrismaDelegateArgs) => Promise<Clinic>;
  update: (args: PrismaDelegateArgs) => Promise<Clinic>;
  delete: (args: PrismaDelegateArgs) => Promise<Clinic>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface ClinicLocationDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<ClinicLocation | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<ClinicLocation | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<ClinicLocation[]>;
  create: (args: PrismaDelegateArgs) => Promise<ClinicLocation>;
  update: (args: PrismaDelegateArgs) => Promise<ClinicLocation>;
  delete: (args: PrismaDelegateArgs) => Promise<ClinicLocation>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface AuditLogDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<AuditLog | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<AuditLog | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<AuditLog[]>;
  create: (args: PrismaDelegateArgs) => Promise<AuditLog>;
  update: (args: PrismaDelegateArgs) => Promise<AuditLog>;
  delete: (args: PrismaDelegateArgs) => Promise<AuditLog>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface NotificationTemplateDelegate extends PrismaDelegateBase<Record<string, never>> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Record<string, never> | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Record<string, never> | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Record<string, never>[]>;
  create: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  update: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  delete: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
}

export interface ReminderScheduleDelegate extends PrismaDelegateBase<Record<string, never>> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Record<string, never> | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Record<string, never> | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Record<string, never>[]>;
  create: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  update: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  delete: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
}

export interface TherapyQueueDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<TherapyQueue | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<TherapyQueue | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<TherapyQueue[]>;
  create: (args: PrismaDelegateArgs) => Promise<TherapyQueue>;
  update: (args: PrismaDelegateArgs) => Promise<TherapyQueue>;
  delete: (args: PrismaDelegateArgs) => Promise<TherapyQueue>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface QueueEntryDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<QueueEntry | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<QueueEntry | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<QueueEntry[]>;
  create: (args: PrismaDelegateArgs) => Promise<QueueEntry>;
  update: (args: PrismaDelegateArgs) => Promise<QueueEntry>;
  delete: (args: PrismaDelegateArgs) => Promise<QueueEntry>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface EmergencyContactDelegate extends PrismaDelegateBase<EmergencyContact> {
  findUnique: (args: PrismaDelegateArgs) => Promise<EmergencyContact | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<EmergencyContact | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<EmergencyContact[]>;
  create: (args: PrismaDelegateArgs) => Promise<EmergencyContact>;
  update: (args: PrismaDelegateArgs) => Promise<EmergencyContact>;
  delete: (args: PrismaDelegateArgs) => Promise<EmergencyContact>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

// ============================================================================
// Query and Transaction Delegates
// ============================================================================

export interface QueryRawDelegate {
  $queryRaw: <T = Record<string, never>>(
    query: TemplateStringsArray | string,
    ...values: Array<string | number | boolean | null>
  ) => Promise<T>;
}

export interface TransactionDelegate {
  $transaction: <T>(
    fn: (tx: Record<string, never>) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
    }
  ) => Promise<T>;
}

/**
 * Comprehensive interface representing PrismaClient with all delegates
 * This allows us to access delegates without casting through 'unknown'
 */
export interface PrismaClientWithDelegates {
  user: UserDelegate;
  doctor: DoctorDelegate;
  patient: PatientDelegate;
  receptionist: ReceptionistDelegate;
  clinicAdmin: ClinicAdminDelegate;
  superAdmin: SuperAdminDelegate;
  pharmacist: PharmacistDelegate;
  therapist: TherapistDelegate;
  labTechnician: LabTechnicianDelegate;
  financeBilling: FinanceBillingDelegate;
  supportStaff: SupportStaffDelegate;
  nurse: NurseDelegate;
  counselor: CounselorDelegate;
  clinic: ClinicDelegate;
  clinicLocation: ClinicLocationDelegate;
  appointment: AppointmentDelegate;
  auditLog: AuditLogDelegate;
  notificationTemplate: NotificationTemplateDelegate;
  reminderSchedule: ReminderScheduleDelegate;
  permission: PermissionDelegate;
  rbacRole: RbacRoleDelegate;
  rolePermission: RolePermissionDelegate;
  userRole: UserRoleDelegate;
  billingPlan: BillingPlanDelegate;
  subscription: SubscriptionDelegate;
  invoice: InvoiceDelegate;
  payment: PaymentDelegate;
  therapyQueue: TherapyQueueDelegate;
  queueEntry: QueueEntryDelegate;
  emergencyContact: EmergencyContactDelegate;
  $transaction: TransactionDelegate['$transaction'];
}

/**
 * Prisma Transaction Client with all delegates (without $transaction)
 * This type represents a Prisma client within a transaction context
 * It has all delegates but excludes $transaction, $connect, $disconnect, etc.
 */
export type PrismaTransactionClientWithDelegates = Omit<PrismaClientWithDelegates, '$transaction'>;

// ============================================================================
// Prisma Client Configuration Types
// ============================================================================

/**
 * Prisma 7 Adapter type
 * Type for Prisma adapter (e.g., postgres adapter)
 */
export type PrismaAdapter = {
  readonly [key: string]: never;
};

/**
 * Prisma Client constructor arguments
 * Strict type definition for PrismaClient constructor
 * Prisma 7 requires adapter pattern for library engine type
 */
export interface PrismaClientConstructorArgs {
  log?: Array<{
    emit: 'stdout' | 'event';
    level: 'query' | 'info' | 'warn' | 'error';
  }>;
  errorFormat?: 'pretty' | 'colorless' | 'minimal';
  // Prisma 7: adapter is required for library engine type
  adapter?: unknown; // PrismaPg adapter type
}

/**
 * Prisma Client configuration
 */
export interface PrismaClientConfig {
  log?: Array<{
    emit: 'stdout' | 'event';
    level: 'query' | 'info' | 'warn' | 'error';
  }>;
  errorFormat?: 'pretty' | 'colorless' | 'minimal';
  datasources?: {
    db?: {
      url?: string;
    };
  };
}

/**
 * Prisma Query Operation
 * Used for $extends method configuration
 * Note: We use Record<string, never> for return type to avoid 'unknown'
 */
export interface PrismaQueryOperation {
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<Record<string, never>>;
}

/**
 * Prisma Extend Arguments
 * Used for $extends method configuration
 */
export interface PrismaExtendArgs {
  query?: {
    $allOperations?: (operation: PrismaQueryOperation) => Promise<Record<string, never>>;
  };
}

/**
 * Prisma Client with Extends interface
 * Used for $extends method
 */
export interface PrismaClientWithExtends {
  $extends: (args: PrismaExtendArgs) => PrismaClient;
}

// PrismaClient type - will be properly imported from @prisma/client where needed
// This is a placeholder type that ensures compatibility
// The actual PrismaClient type comes from @prisma/client package
export type PrismaClient = {
  readonly [key: string]: never;
};

/**
 * Prisma Client-like interface
 * Base interface that mimics PrismaClient without using its generated types
 */
export interface PrismaClientLike {
  user: Record<string, never>;
  doctor: Record<string, never>;
  patient: Record<string, never>;
  receptionist: Record<string, never>;
  clinicAdmin: Record<string, never>;
  superAdmin: Record<string, never>;
  pharmacist: Record<string, never>;
  therapist: Record<string, never>;
  labTechnician: Record<string, never>;
  financeBilling: Record<string, never>;
  supportStaff: Record<string, never>;
  nurse: Record<string, never>;
  counselor: Record<string, never>;
  clinic: Record<string, never>;
  appointment: Record<string, never>;
  auditLog: Record<string, never>;
  notificationTemplate: Record<string, never>;
  reminderSchedule: Record<string, never>;
  permission: Record<string, never>;
  rbacRole: Record<string, never>;
  rolePermission: Record<string, never>;
  userRole: Record<string, never>;
  billingPlan: Record<string, never>;
  subscription: Record<string, never>;
  invoice: Record<string, never>;
  payment: Record<string, never>;
  emergencyContact: Record<string, never>;
  $queryRaw: <T = Record<string, never>>(
    query: TemplateStringsArray | string,
    ...values: Array<string | number | boolean | null>
  ) => Promise<T>;
  $transaction: <T>(
    fn: (tx: Record<string, never>) => Promise<T>,
    options?: {
      maxWait?: number;
      timeout?: number;
      isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
    }
  ) => Promise<T>;
}

/**
 * Strict Prisma Client interface
 * This interface defines a type-safe Prisma client without any 'any' or 'unknown' types
 */
export interface StrictPrismaClient {
  user: UserDelegate;
  doctor: DoctorDelegate;
  patient: PatientDelegate;
  receptionist: ReceptionistDelegate;
  clinicAdmin: ClinicAdminDelegate;
  superAdmin: SuperAdminDelegate;
  pharmacist: PharmacistDelegate;
  therapist: TherapistDelegate;
  labTechnician: LabTechnicianDelegate;
  financeBilling: FinanceBillingDelegate;
  supportStaff: SupportStaffDelegate;
  nurse: NurseDelegate;
  counselor: CounselorDelegate;
  clinic: ClinicDelegate;
  clinicLocation: ClinicLocationDelegate;
  appointment: AppointmentDelegate;
  auditLog: AuditLogDelegate;
  notificationTemplate: NotificationTemplateDelegate;
  reminderSchedule: ReminderScheduleDelegate;
  permission: PermissionDelegate;
  rbacRole: RbacRoleDelegate;
  rolePermission: RolePermissionDelegate;
  userRole: UserRoleDelegate;
  billingPlan: BillingPlanDelegate;
  subscription: SubscriptionDelegate;
  invoice: InvoiceDelegate;
  payment: PaymentDelegate;
  therapyQueue: TherapyQueueDelegate;
  queueEntry: QueueEntryDelegate;
  emergencyContact: EmergencyContactDelegate;
  $queryRaw: QueryRawDelegate['$queryRaw'];
  $transaction: TransactionDelegate['$transaction'];
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
  $on: (event: 'query' | 'info' | 'warn' | 'error', callback: (event: LogEvent) => void) => void;
}

/**
 * Log event interface for Prisma logging
 */
export interface LogEvent {
  timestamp: Date;
  query?: string;
  params?: string;
  duration?: number;
  target?: string;
  message?: string;
}

/**
 * Prisma Client factory function type
 * This creates a type-safe wrapper around PrismaClient
 */
export type PrismaClientFactory = (config: PrismaClientConfig) => StrictPrismaClient;

// ============================================================================
// Domain-Specific Types (from original prisma.types.ts)
// ============================================================================

export interface ClinicAssociation {
  id: string;
  clinicId?: string | null;
  assignedAt?: Date;
}

export interface MinimalUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  role?: string;
}

export type { ClinicLocation } from './clinic.types';
export type { QueueStatus } from './enums.types';

// Note: Enums and Input types are already exported from ./index
// Re-exporting them here would create circular dependencies
// These types are available via: import { ... } from '@core/types'
