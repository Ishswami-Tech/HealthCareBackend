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
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  EXPIRED = 'EXPIRED',
  PENDING = 'PENDING',
  FOLLOW_UP_SCHEDULED = 'FOLLOW_UP_SCHEDULED',
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

export enum AppointmentServiceCategory {
  CONSULTATION = 'CONSULTATION',
  DIAGNOSIS = 'DIAGNOSIS',
  TREATMENT = 'TREATMENT',
  SURGERY = 'SURGERY',
  COUNSELING = 'COUNSELING',
  THERAPY = 'THERAPY',
}

export enum AppointmentQueueCategory {
  DOCTOR_CONSULTATION = 'DOCTOR_CONSULTATION',
  THERAPY_PROCEDURE = 'THERAPY_PROCEDURE',
  MEDICINE_DESK = 'MEDICINE_DESK',
}

export enum AppointmentBillingMode {
  SUBSCRIPTION_INCLUDED = 'SUBSCRIPTION_INCLUDED',
  PER_APPOINTMENT_PAYMENT = 'PER_APPOINTMENT_PAYMENT',
}

export enum TreatmentType {
  GENERAL_CONSULTATION = 'GENERAL_CONSULTATION',
  FOLLOW_UP = 'FOLLOW_UP',
  THERAPY = 'THERAPY',
  SURGERY = 'SURGERY',
  LAB_TEST = 'LAB_TEST',
  IMAGING = 'IMAGING',
  VACCINATION = 'VACCINATION',
  SPECIAL_CASE = 'SPECIAL_CASE',
  GERIATRIC_CARE = 'GERIATRIC_CARE',
  // Ayurveda Types
  VIDDHAKARMA = 'VIDDHAKARMA',
  AGNIKARMA = 'AGNIKARMA',
  PANCHAKARMA = 'PANCHAKARMA',
  NADI_PARIKSHA = 'NADI_PARIKSHA',
  DOSHA_ANALYSIS = 'DOSHA_ANALYSIS',
  SHIRODHARA = 'SHIRODHARA',
  VIRECHANA = 'VIRECHANA',
  ABHYANGA = 'ABHYANGA',
  SWEDANA = 'SWEDANA',
  BASTI = 'BASTI',
  NASYA = 'NASYA',
  RAKTAMOKSHANA = 'RAKTAMOKSHANA',
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
 * Physical/Virtual Lane Types for appointment queues
 */
export enum LaneType {
  WAITING_ROOM = 'WAITING_ROOM',
  FOLLOW_UP = 'FOLLOW_UP',
  AGNIKARMA = 'AGNIKARMA',
  PANCHAKARMA = 'PANCHAKARMA',
  VIDDHAKARMA = 'VIDDHAKARMA',
  GENERAL_CONSULTATION = 'GENERAL_CONSULTATION',
  VIP = 'VIP',
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
 * Delivery status enumeration
 */
export enum DeliveryStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  BOUNCED = 'BOUNCED',
  REJECTED = 'REJECTED',
}

/**
 * Suppression reason enumeration
 */
export enum SuppressionReason {
  BOUNCE = 'BOUNCE',
  COMPLAINT = 'COMPLAINT',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  MANUAL = 'MANUAL',
}

/**
 * Suppression source enumeration
 */
export enum SuppressionSource {
  SES = 'SES',
  ZEPTOMAIL = 'ZEPTOMAIL',
  USER_ACTION = 'USER_ACTION',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
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
  GENERAL_DOCUMENT = 'GENERAL_DOCUMENT',
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
  NUTRITIONIST = 'NUTRITIONIST',
  FINANCE_BILLING = 'FINANCE_BILLING',
  SUPPORT_STAFF = 'SUPPORT_STAFF',
  NURSE = 'NURSE',
  COUNSELOR = 'COUNSELOR',
  CLINIC_LOCATION_HEAD = 'CLINIC_LOCATION_HEAD',
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

/**
 * Stock movement type enumeration
 * @enum MovementType
 * @description Types of stock movements in pharmacy inventory
 */
export enum MovementType {
  PURCHASE_IN = 'PURCHASE_IN',
  DISPENSE_OUT = 'DISPENSE_OUT',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
  ADJUSTMENT = 'ADJUSTMENT',
  EXPIRED_WRITE_OFF = 'EXPIRED_WRITE_OFF',
  RETURN_IN = 'RETURN_IN',
}

/**
 * Stock transfer status enumeration
 * @enum TransferStatus
 * @description Lifecycle states for inter-clinic stock transfers
 */
export enum TransferStatus {
  DRAFT = 'DRAFT',
  IN_TRANSIT = 'IN_TRANSIT',
  RECEIVED = 'RECEIVED',
  CANCELLED = 'CANCELLED',
}

/**
 * Reorder strategy enumeration
 * @enum ReorderStrategy
 * @description Strategies for automatic reorder point calculation
 */
export enum ReorderStrategy {
  FIXED_QTY = 'FIXED_QTY',
  MIN_MAX = 'MIN_MAX',
  REORDER_POINT = 'REORDER_POINT',
}

/**
 * Stock alert type enumeration
 * @enum AlertType
 * @description Types of alerts generated by pharmacy inventory
 */
export enum AlertType {
  EXPIRY_WARNING = 'EXPIRY_WARNING',
  EXPIRY_CRITICAL = 'EXPIRY_CRITICAL',
  LOW_STOCK = 'LOW_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  REORDER_NEEDED = 'REORDER_NEEDED',
  EXPIRED_WRITE_OFF = 'EXPIRED_WRITE_OFF',
}
