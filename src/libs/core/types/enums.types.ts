/**
 * Enums - Centralized enum definitions
 * All enums should be defined here, not in database module files
 */

/**
 * User status enumeration
 */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  PENDING = 'PENDING',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Appointment status enumeration
 */
export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CHECKED_IN = 'CHECKED_IN',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  PENDING = 'PENDING',
  FOLLOW_UP_SCHEDULED = 'FOLLOW_UP_SCHEDULED',
  AWAITING_SLOT_CONFIRMATION = 'AWAITING_SLOT_CONFIRMATION',
}

/**
 * Payment status enumeration
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

/**
 * Payment method enumeration
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  INSURANCE = 'INSURANCE',
}

/**
 * Billing interval enumeration
 */
export enum BillingInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

/**
 * Subscription status enumeration
 */
export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  INCOMPLETE = 'INCOMPLETE',
  INCOMPLETE_EXPIRED = 'INCOMPLETE_EXPIRED',
  TRIALING = 'TRIALING',
  PAUSED = 'PAUSED',
}

/**
 * Invoice status enumeration
 */
export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
  OVERDUE = 'OVERDUE',
}

/**
 * Language enumeration
 */
export enum Language {
  EN = 'EN',
  HI = 'HI',
  MR = 'MR',
}

/**
 * Appointment type enumeration
 */
export enum AppointmentType {
  IN_PERSON = 'IN_PERSON',
  VIDEO_CALL = 'VIDEO_CALL',
  HOME_VISIT = 'HOME_VISIT',
}

/**
 * Prakriti (Ayurvedic constitution) enumeration
 */
export enum Prakriti {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
  VATA_PITTA = 'VATA_PITTA',
  PITTA_KAPHA = 'PITTA_KAPHA',
  VATA_KAPHA = 'VATA_KAPHA',
  TRIDOSHA = 'TRIDOSHA',
}

/**
 * Medicine type enumeration
 */
export enum MedicineType {
  CLASSICAL = 'CLASSICAL',
  PROPRIETARY = 'PROPRIETARY',
  HERBAL = 'HERBAL',
}

/**
 * Queue status enumeration
 */
export enum QueueStatus {
  WAITING = 'WAITING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

/**
 * Notification type enumeration
 */
export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH_NOTIFICATION = 'PUSH_NOTIFICATION',
}

/**
 * Notification status enumeration
 */
export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
}

/**
 * Health record type enumeration
 */
export enum HealthRecordType {
  LAB_TEST = 'LAB_TEST',
  XRAY = 'XRAY',
  MRI = 'MRI',
  PRESCRIPTION = 'PRESCRIPTION',
  DIAGNOSIS_REPORT = 'DIAGNOSIS_REPORT',
  PULSE_DIAGNOSIS = 'PULSE_DIAGNOSIS',
}

/**
 * Dosha (Ayurvedic principle) enumeration
 */
export enum Dosha {
  VATA = 'VATA',
  PITTA = 'PITTA',
  KAPHA = 'KAPHA',
}

/**
 * Therapy type enumeration
 */
export enum TherapyType {
  SHODHANA = 'SHODHANA',
  SHAMANA = 'SHAMANA',
  RASAYANA = 'RASAYANA',
  VAJIKARANA = 'VAJIKARANA',
}

/**
 * Therapy duration enumeration
 */
export enum TherapyDuration {
  SHORT = 'SHORT',
  MEDIUM = 'MEDIUM',
  LONG = 'LONG',
  EXTENDED = 'EXTENDED',
}

/**
 * Agni type enumeration
 */
export enum AgniType {
  SAMA = 'SAMA',
  VISHAMA = 'VISHAMA',
  TIKSHNA = 'TIKSHNA',
  MANDA = 'MANDA',
}

/**
 * Therapy status enumeration
 */
export enum TherapyStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  RESCHEDULED = 'RESCHEDULED',
}

/**
 * Role enumeration (matches Prisma schema)
 * @enum Role
 */
export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  CLINIC_ADMIN = 'CLINIC_ADMIN',
  DOCTOR = 'DOCTOR',
  ASSISTANT_DOCTOR = 'ASSISTANT_DOCTOR',
  PATIENT = 'PATIENT',
  RECEPTIONIST = 'RECEPTIONIST',
  PHARMACIST = 'PHARMACIST',
  THERAPIST = 'THERAPIST',
  LAB_TECHNICIAN = 'LAB_TECHNICIAN',
  FINANCE_BILLING = 'FINANCE_BILLING',
  SUPPORT_STAFF = 'SUPPORT_STAFF',
  NURSE = 'NURSE',
  COUNSELOR = 'COUNSELOR',
  LOCATION_HEAD = 'LOCATION_HEAD',
}

/**
 * Special case enumeration for patients
 * @enum SpecialCase
 */
export enum SpecialCase {
  MINOR_AGE_12_OR_BELOW = 'MINOR_AGE_12_OR_BELOW',
  PHYSICAL_HANDICAP = 'PHYSICAL_HANDICAP',
  PREGNANT_WOMEN = 'PREGNANT_WOMEN',
  SENIOR_CITIZEN = 'SENIOR_CITIZEN',
}
