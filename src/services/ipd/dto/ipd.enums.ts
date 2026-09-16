/**
 * IPD Enums
 * @module IPD Enums
 * @description Enumerations for ward, bed, admission, nursing, and medication operations
 */

/**
 * Types of hospital wards
 * @enum WardType
 */
export enum WardType {
  GENERAL = 'GENERAL',
  SEMI_PRIVATE = 'SEMI_PRIVATE',
  PRIVATE = 'PRIVATE',
  ICU = 'ICU',
  NICU = 'NICU',
  HDU = 'HDU',
  ISOLATION = 'ISOLATION',
  EMERGENCY = 'EMERGENCY',
  OPERATION_THEATER = 'OPERATION_THEATER',
  RECOVERY = 'RECOVERY',
}

/**
 * Status of a hospital bed
 * @enum BedStatus
 */
export enum BedStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
  CLEANING = 'CLEANING',
  MAINTENANCE = 'MAINTENANCE',
}

/**
 * Status of an in-patient admission
 * @enum AdmissionStatus
 */
export enum AdmissionStatus {
  ADMITTED = 'ADMITTED',
  TRANSFERRED = 'TRANSFERRED',
  DISCHARGED = 'DISCHARGED',
  AMA = 'AMA',
  LAMA = 'LAMA',
  EXPIRED = 'EXPIRED',
}

/**
 * Severity level for nursing notes
 * @enum NoteSeverity
 */
export enum NoteSeverity {
  ROUTINE = 'ROUTINE',
  URGENT = 'URGENT',
  CRITICAL = 'CRITICAL',
}

/**
 * Routes for medication administration
 * @enum MedicationRoute
 */
export enum MedicationRoute {
  ORAL = 'ORAL',
  IV = 'IV',
  IM = 'IM',
  SC = 'SC',
  TOPICAL = 'TOPICAL',
  INHALATION = 'INHALATION',
  SUBLINGUAL = 'SUBLINGUAL',
  NASAL = 'NASAL',
  RECTAL = 'RECTAL',
}

/**
 * Discharge type classification
 * @enum DischargeType
 */
export enum DischargeType {
  REGULAR = 'REGULAR',
  AGAINST_MEDICAL_ADVICE = 'AGAINST_MEDICAL_ADVICE',
  LEFT_AGAINST_ADVICE = 'LEFT_AGAINST_ADVICE',
  TRANSFER = 'TRANSFER',
  EXPIRED = 'EXPIRED',
}
