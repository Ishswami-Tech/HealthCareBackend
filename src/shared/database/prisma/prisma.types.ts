import { PrismaClient } from '@prisma/client'

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
  AuditLog as PrismaAuditLog
} from '.prisma/client'

// Re-export types with our preferred names
export type User = PrismaUser
export type Product = PrismaProduct
export type Appointment = PrismaAppointment
export type Payment = PrismaPayment
export type Doctor = PrismaDoctor
export type Patient = PrismaPatient
export type Clinic = PrismaClinic
export type ClinicAdmin = PrismaClinicAdmin
export type SuperAdmin = PrismaSuperAdmin
export type Receptionist = PrismaReceptionist
export type DoctorClinic = PrismaDoctorClinic
export type Medicine = PrismaMedicine
export type Therapy = PrismaTherapy
export type Prescription = PrismaPrescription
export type PrescriptionItem = PrismaPrescriptionItem
export type Queue = PrismaQueue
export type HealthRecord = PrismaHealthRecord
export type Review = PrismaReview
export type Notification = PrismaNotification
export type AuditLog = PrismaAuditLog

// Define and export all enums
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  CLINIC_ADMIN = 'CLINIC_ADMIN',
  DOCTOR = 'DOCTOR',
  PATIENT = 'PATIENT',
  RECEPTIONIST = 'RECEPTIONIST'
}

export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER'
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED'
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING'
}

export enum AppointmentType {
  IN_PERSON = 'IN_PERSON',
  VIDEO_CALL = 'VIDEO_CALL',
  HOME_VISIT = 'HOME_VISIT'
}

export enum Prakriti {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
  VATA_PITTA = 'VATA_PITTA',
  PITTA_KAPHA = 'PITTA_KAPHA',
  VATA_KAPHA = 'VATA_KAPHA',
  TRIDOSHA = 'TRIDOSHA'
}

export enum MedicineType {
  CLASSICAL = 'CLASSICAL',
  PROPRIETARY = 'PROPRIETARY',
  HERBAL = 'HERBAL'
}

export enum QueueStatus {
  WAITING = 'WAITING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED'
}

export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH_NOTIFICATION = 'PUSH_NOTIFICATION'
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED'
}

export enum HealthRecordType {
  LAB_TEST = 'LAB_TEST',
  XRAY = 'XRAY',
  MRI = 'MRI',
  PRESCRIPTION = 'PRESCRIPTION',
  DIAGNOSIS_REPORT = 'DIAGNOSIS_REPORT',
  PULSE_DIAGNOSIS = 'PULSE_DIAGNOSIS'
}

export enum Dosha {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA'
}

// Export Prisma namespace for input types
export { Prisma } from '@prisma/client'

// Singleton pattern for PrismaClient with lazy initialization
let prisma: PrismaClient | undefined

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: ['query', 'info', 'warn', 'error'],
    })
  }
  return prisma
}

// Initialize on first import
export default getPrismaClient() 