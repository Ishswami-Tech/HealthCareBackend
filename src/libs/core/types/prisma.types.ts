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
  DoctorWithRelations,
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
  DoctorClinic,
  EmergencyContact,
  Review,
  Medicine,
  Prescription,
  PrescriptionItem,
  Therapy,
  Queue,
  HealthRecord,
  ClinicExpense,
  MedicalDocument,
  Insurance,
  Notification,
  InsuranceClaim,
  LocationHead,
} from './database.types';
import type { ClinicLocation } from './clinic.types';

import type { UserWithRelations } from './user.types';

import type { TherapyQueue, QueueEntry } from './appointment.types';

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

export interface PrismaDelegateBase<
  TEntity,
  TAggregate = { _sum?: { amount: number | null }; _count?: { id: number } },
> {
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
  aggregate: (args: PrismaDelegateArgs) => Promise<TAggregate>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<PrismaDelegateArgs>>;
}

export interface UserDelegate extends PrismaDelegateBase<UserWithRelations> {
  findUnique: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<UserWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<UserWithRelations[]>;
  create: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
  update: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<UserWithRelations>;
}

export interface AppointmentDelegate extends PrismaDelegateBase<
  AppointmentWithRelations,
  {
    _avg?: { duration: number | null };
    _sum?: { duration: number | null };
    _count?: { id: number };
  }
> {
  findUnique: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations[]>;
  update: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations>;
  delete: (args: PrismaDelegateArgs) => Promise<AppointmentWithRelations>;
  aggregate: (args: PrismaDelegateArgs) => Promise<{
    _avg?: { duration: number | null };
    _sum?: { duration: number | null };
    _count?: { id: number };
  }>;
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

export function toPermissionEntity(prismaPermission: unknown): PermissionEntity {
  return prismaPermission as PermissionEntity;
}

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
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<Record<string, never>>;
  groupBy: (args: PrismaDelegateArgs) => Promise<Array<Record<string, never>>>;
}

export interface ReviewDelegate extends PrismaDelegateBase<
  Review,
  { _avg?: { rating: number | null }; _sum?: { rating: number | null } }
> {
  aggregate: (
    args: PrismaDelegateArgs
  ) => Promise<{ _avg?: { rating: number | null }; _sum?: { rating: number | null } }>;
}

export interface DoctorDelegate extends PrismaDelegateBase<DoctorWithRelations> {
  user: UserDelegate;
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

export interface LocationHeadDelegate extends PrismaDelegateBase<LocationHead> {
  findUnique: (args: PrismaDelegateArgs) => Promise<LocationHead | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<LocationHead | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<LocationHead[]>;
  create: (args: PrismaDelegateArgs) => Promise<LocationHead>;
  update: (args: PrismaDelegateArgs) => Promise<LocationHead>;
  delete: (args: PrismaDelegateArgs) => Promise<LocationHead>;
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

export interface DoctorClinicDelegate {
  findUnique: (args: PrismaDelegateArgs) => Promise<DoctorClinic | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<DoctorClinic | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<DoctorClinic[]>;
  create: (args: PrismaDelegateArgs) => Promise<DoctorClinic>;
  update: (args: PrismaDelegateArgs) => Promise<DoctorClinic>;
  delete: (args: PrismaDelegateArgs) => Promise<DoctorClinic>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
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

export interface HealthRecordDelegate extends PrismaDelegateBase<HealthRecord> {
  findUnique: (args: PrismaDelegateArgs) => Promise<HealthRecord | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<HealthRecord | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<HealthRecord[]>;
  create: (args: PrismaDelegateArgs) => Promise<HealthRecord>;
  update: (args: PrismaDelegateArgs) => Promise<HealthRecord>;
  delete: (args: PrismaDelegateArgs) => Promise<HealthRecord>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface MedicineDelegate extends PrismaDelegateBase<
  Medicine,
  { _count?: { id: number } }
> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Medicine | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Medicine | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Medicine[]>;
  create: (args: PrismaDelegateArgs) => Promise<Medicine>;
  update: (args: PrismaDelegateArgs) => Promise<Medicine>;
  delete: (args: PrismaDelegateArgs) => Promise<Medicine>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<{ _count?: { id: number } }>;
}

export interface PrescriptionDelegate extends PrismaDelegateBase<Prescription> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Prescription | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Prescription | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Prescription[]>;
  create: (args: PrismaDelegateArgs) => Promise<Prescription>;
  update: (args: PrismaDelegateArgs) => Promise<Prescription>;
  delete: (args: PrismaDelegateArgs) => Promise<Prescription>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface PrescriptionItemDelegate extends PrismaDelegateBase<PrescriptionItem> {
  findUnique: (args: PrismaDelegateArgs) => Promise<PrescriptionItem | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<PrescriptionItem | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<PrescriptionItem[]>;
  create: (args: PrismaDelegateArgs) => Promise<PrescriptionItem>;
  update: (args: PrismaDelegateArgs) => Promise<PrescriptionItem>;
  delete: (args: PrismaDelegateArgs) => Promise<PrescriptionItem>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface TherapyDelegate extends PrismaDelegateBase<Therapy> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Therapy | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Therapy | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Therapy[]>;
  create: (args: PrismaDelegateArgs) => Promise<Therapy>;
  update: (args: PrismaDelegateArgs) => Promise<Therapy>;
  delete: (args: PrismaDelegateArgs) => Promise<Therapy>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface QueueDelegate extends PrismaDelegateBase<Queue> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Queue | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Queue | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Queue[]>;
  create: (args: PrismaDelegateArgs) => Promise<Queue>;
  update: (args: PrismaDelegateArgs) => Promise<Queue>;
  delete: (args: PrismaDelegateArgs) => Promise<Queue>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface NotificationDelegate extends PrismaDelegateBase<Notification> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Notification | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Notification | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Notification[]>;
  create: (args: PrismaDelegateArgs) => Promise<Notification>;
  update: (args: PrismaDelegateArgs) => Promise<Notification>;
  delete: (args: PrismaDelegateArgs) => Promise<Notification>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface ClinicExpenseDelegate extends PrismaDelegateBase<
  ClinicExpense,
  { _sum?: { amount: number | null } }
> {
  findUnique: (args: PrismaDelegateArgs) => Promise<ClinicExpense | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<ClinicExpense | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<ClinicExpense[]>;
  create: (args: PrismaDelegateArgs) => Promise<ClinicExpense>;
  update: (args: PrismaDelegateArgs) => Promise<ClinicExpense>;
  delete: (args: PrismaDelegateArgs) => Promise<ClinicExpense>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
  aggregate: (args: PrismaDelegateArgs) => Promise<{ _sum?: { amount: number | null } }>;
}

export interface MedicalDocumentDelegate extends PrismaDelegateBase<MedicalDocument> {
  findUnique: (args: PrismaDelegateArgs) => Promise<MedicalDocument | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<MedicalDocument | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<MedicalDocument[]>;
  create: (args: PrismaDelegateArgs) => Promise<MedicalDocument>;
  update: (args: PrismaDelegateArgs) => Promise<MedicalDocument>;
  delete: (args: PrismaDelegateArgs) => Promise<MedicalDocument>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface InsuranceDelegate extends PrismaDelegateBase<Insurance> {
  findUnique: (args: PrismaDelegateArgs) => Promise<Insurance | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<Insurance | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<Insurance[]>;
  create: (args: PrismaDelegateArgs) => Promise<Insurance>;
  update: (args: PrismaDelegateArgs) => Promise<Insurance>;
  delete: (args: PrismaDelegateArgs) => Promise<Insurance>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

export interface InsuranceClaimDelegate extends PrismaDelegateBase<InsuranceClaim> {
  findUnique: (args: PrismaDelegateArgs) => Promise<InsuranceClaim | null>;
  findFirst: (args: PrismaDelegateArgs) => Promise<InsuranceClaim | null>;
  findMany: (args: PrismaDelegateArgs) => Promise<InsuranceClaim[]>;
  create: (args: PrismaDelegateArgs) => Promise<InsuranceClaim>;
  update: (args: PrismaDelegateArgs) => Promise<InsuranceClaim>;
  delete: (args: PrismaDelegateArgs) => Promise<InsuranceClaim>;
  createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  count: (args?: PrismaDelegateArgs) => Promise<number>;
}

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
  doctorClinic: DoctorClinicDelegate;
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
  review: ReviewDelegate;
  locationHead: LocationHeadDelegate;
  // New delegates
  healthRecord: HealthRecordDelegate;
  medicine: MedicineDelegate;
  prescription: PrescriptionDelegate;
  prescriptionItem: PrescriptionItemDelegate;
  therapy: TherapyDelegate;
  queue: QueueDelegate;
  notification: NotificationDelegate;
  clinicExpense: ClinicExpenseDelegate;
  medicalDocument: MedicalDocumentDelegate;
  insurance: InsuranceDelegate;
  insuranceClaim: InsuranceClaimDelegate;
  // Transaction
  $transaction: TransactionDelegate['$transaction'];
}

export type PrismaTransactionClientWithDelegates = Omit<PrismaClientWithDelegates, '$transaction'>;

export type PrismaAdapter = {
  readonly [key: string]: never;
};

export interface PrismaClientConstructorArgs {
  log?: Array<{
    emit: 'stdout' | 'event';
    level: 'query' | 'info' | 'warn' | 'error';
  }>;
  errorFormat?: 'pretty' | 'colorless' | 'minimal';
  adapter?: unknown;
}

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

export interface PrismaQueryOperation {
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => Promise<Record<string, never>>;
}

export interface PrismaExtendArgs {
  query?: {
    $allOperations?: (operation: PrismaQueryOperation) => Promise<Record<string, never>>;
  };
}

export interface PrismaClientWithExtends {
  $extends: (args: PrismaExtendArgs) => PrismaClient;
}

export type PrismaClient = {
  readonly [key: string]: never;
};

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
  healthRecord: Record<string, never>;
  medicine: Record<string, never>;
  prescription: Record<string, never>;
  prescriptionItem: Record<string, never>;
  therapy: Record<string, never>;
  queue: Record<string, never>;
  notification: Record<string, never>;
  clinicExpense: Record<string, never>;
  medicalDocument: Record<string, never>;
  insurance: Record<string, never>;
  insuranceClaim: Record<string, never>;
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
  doctorClinic: DoctorClinicDelegate;
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
  // New delegates
  healthRecord: HealthRecordDelegate;
  medicine: MedicineDelegate;
  prescription: PrescriptionDelegate;
  prescriptionItem: PrescriptionItemDelegate;
  therapy: TherapyDelegate;
  queue: QueueDelegate;
  notification: NotificationDelegate;
  clinicExpense: ClinicExpenseDelegate;
  medicalDocument: MedicalDocumentDelegate;
  insurance: InsuranceDelegate;
  insuranceClaim: InsuranceClaimDelegate;
  // Core methods
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
