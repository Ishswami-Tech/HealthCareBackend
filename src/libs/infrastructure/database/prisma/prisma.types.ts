import { PrismaClient } from "@prisma/client";

// Import types from generated Prisma client
import type {
  User as PrismaUser,
  Product as PrismaProduct,
  Appointment as PrismaAppointment,
  Payment as PrismaPayment,
  Doctor as PrismaDoctor,
  Patient as PrismaPatient,
  Clinic as PrismaClinic,
  ClinicAdmin as PrismaClinicAdmin,
  SuperAdmin as PrismaSuperAdmin,
  Receptionist as PrismaReceptionist,
  DoctorClinic as PrismaDoctorClinic,
  Medicine as PrismaMedicine,
  Therapy as PrismaTherapy,
  Prescription as PrismaPrescription,
  PrescriptionItem as PrismaPrescriptionItem,
  Queue as PrismaQueue,
  HealthRecord as PrismaHealthRecord,
  Review as PrismaReview,
  Notification as PrismaNotification,
  AuditLog as PrismaAuditLog,
} from ".prisma/client";

// Re-export types with our preferred names
export type User = PrismaUser & {
  emergencyContact?: string;
  primaryClinicId?: string;
  primaryClinic?: Clinic;
  clinics?: Clinic[];
  clinicAdmins?: ClinicAdmin[];
  receptionists?: Receptionist[];
  doctorClinics?: DoctorClinic[];
};
export type Product = PrismaProduct;
export type Appointment = PrismaAppointment;
export type Payment = PrismaPayment;

// Define billing types manually since they're not available in Prisma client
export type BillingPlan = {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  isActive: boolean;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments: boolean;
  appointmentTypes?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  subscriptions?: Subscription[];
};

export type Subscription = {
  id: string;
  userId: string;
  planId: string;
  clinicId: string;
  status: string;
  startDate: Date;
  endDate?: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
  appointmentsUsed: number;
  appointmentsRemaining?: number;
  createdAt: Date;
  updatedAt: Date;
  plan?: BillingPlan;
  payments?: Payment[];
  invoices?: Invoice[];
  appointments?: Appointment[];
};

export type Invoice = {
  id: string;
  invoiceNumber: string;
  userId: string;
  subscriptionId?: string;
  clinicId: string;
  amount: number;
  tax?: number;
  discount?: number;
  totalAmount: number;
  status: string;
  dueDate: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp: boolean;
  createdAt: Date;
  updatedAt: Date;
  subscription?: Subscription;
  payments?: Payment[];
};
export type Doctor = PrismaDoctor;
export type Patient = PrismaPatient;
export type Clinic = PrismaClinic & {
  primaryUsers?: User[];
  users?: User[];
};
export type ClinicAdmin = PrismaClinicAdmin;
export type SuperAdmin = PrismaSuperAdmin;
export type Receptionist = PrismaReceptionist;
export type DoctorClinic = PrismaDoctorClinic;
export type Medicine = PrismaMedicine;
export type Therapy = PrismaTherapy;
export type Prescription = PrismaPrescription;
export type PrescriptionItem = PrismaPrescriptionItem;
export type Queue = PrismaQueue;
export type HealthRecord = PrismaHealthRecord;
export type Review = PrismaReview;
export type Notification = PrismaNotification;
export type AuditLog = PrismaAuditLog;

// Define and export all enums - Updated to match schema
export enum Role {
  SUPER_ADMIN = "SUPER_ADMIN",
  CLINIC_ADMIN = "CLINIC_ADMIN",
  DOCTOR = "DOCTOR",
  PATIENT = "PATIENT",
  RECEPTIONIST = "RECEPTIONIST",
  PHARMACIST = "PHARMACIST",
  THERAPIST = "THERAPIST",
  LAB_TECHNICIAN = "LAB_TECHNICIAN",
  FINANCE_BILLING = "FINANCE_BILLING",
  SUPPORT_STAFF = "SUPPORT_STAFF",
  NURSE = "NURSE",
  COUNSELOR = "COUNSELOR",
}

export enum Gender {
  MALE = "MALE",
  FEMALE = "FEMALE",
  OTHER = "OTHER",
}

export enum AppointmentStatus {
  SCHEDULED = "SCHEDULED",
  CHECKED_IN = "CHECKED_IN",
  CONFIRMED = "CONFIRMED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  NO_SHOW = "NO_SHOW",
  PENDING = "PENDING",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum PaymentMethod {
  CASH = "CASH",
  CARD = "CARD",
  UPI = "UPI",
  NET_BANKING = "NET_BANKING",
}

export enum Language {
  EN = "EN",
  HI = "HI",
  MR = "MR",
}

export enum AppointmentType {
  IN_PERSON = "IN_PERSON",
  VIDEO_CALL = "VIDEO_CALL",
  HOME_VISIT = "HOME_VISIT",
}

export enum Prakriti {
  VATA = "VATA",
  PITTA = "PITTA",
  KAPHA = "KAPHA",
  VATA_PITTA = "VATA_PITTA",
  PITTA_KAPHA = "PITTA_KAPHA",
  VATA_KAPHA = "VATA_KAPHA",
  TRIDOSHA = "TRIDOSHA",
}

export enum MedicineType {
  CLASSICAL = "CLASSICAL",
  PROPRIETARY = "PROPRIETARY",
  HERBAL = "HERBAL",
}

export enum QueueStatus {
  WAITING = "WAITING",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
}

export enum NotificationType {
  EMAIL = "EMAIL",
  SMS = "SMS",
  PUSH_NOTIFICATION = "PUSH_NOTIFICATION",
}

export enum NotificationStatus {
  PENDING = "PENDING",
  SENT = "SENT",
  FAILED = "FAILED",
}

export enum HealthRecordType {
  LAB_TEST = "LAB_TEST",
  XRAY = "XRAY",
  MRI = "MRI",
  PRESCRIPTION = "PRESCRIPTION",
  DIAGNOSIS_REPORT = "DIAGNOSIS_REPORT",
  PULSE_DIAGNOSIS = "PULSE_DIAGNOSIS",
}

export enum Dosha {
  VATA = "VATA",
  PITTA = "PITTA",
  KAPHA = "KAPHA",
}

// Ayurvedic Enums
export enum TherapyType {
  SHODHANA = "SHODHANA",
  SHAMANA = "SHAMANA",
  RASAYANA = "RASAYANA",
  VAJIKARANA = "VAJIKARANA",
}

export enum TherapyDuration {
  SHORT = "SHORT",
  MEDIUM = "MEDIUM",
  LONG = "LONG",
  EXTENDED = "EXTENDED",
}

export enum AgniType {
  SAMA = "SAMA",
  VISHAMA = "VISHAMA",
  TIKSHNA = "TIKSHNA",
  MANDA = "MANDA",
}

export enum TherapyStatus {
  SCHEDULED = "SCHEDULED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
  RESCHEDULED = "RESCHEDULED",
}

// Export Prisma namespace for input types
export { Prisma } from "@prisma/client";

// Export new role types
export type Pharmacist = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type Therapist = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type LabTechnician = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type FinanceBilling = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type SupportStaff = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type Nurse = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

export type Counselor = {
  id: string;
  userId: string;
  createdAt: Date;
  user?: User;
};

// Singleton pattern for PrismaClient with lazy initialization
let prisma: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ["query", "info", "warn", "error"],
    });
  }
  return prisma;
}

// Initialize on first import
export default getPrismaClient();
