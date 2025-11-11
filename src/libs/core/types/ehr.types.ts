/**
 * Centralized EHR (Electronic Health Records) Types
 * @module @core/types/ehr.types
 * @description All EHR-related types and interfaces for the healthcare system
 */

// ============================================================================
// EHR RECORD TYPES
// ============================================================================

/**
 * Medical history record
 */
export interface MedicalHistoryRecord {
  id: string;
  userId: string;
  clinicId: string;
  condition: string;
  diagnosis: string;
  treatment: string;
  date: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lab report record
 */
export interface LabReportRecord {
  id: string;
  userId: string;
  clinicId: string;
  testName: string;
  result: string;
  normalRange: string;
  date: Date;
  doctorId: string;
  labName?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Vital signs record
 */
export interface VitalRecord {
  id: string;
  userId: string;
  clinicId: string;
  type: string;
  value: number;
  unit: string;
  recordedAt: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Allergy record
 */
export interface AllergyRecord {
  id: string;
  userId: string;
  clinicId: string;
  allergen: string;
  severity: string;
  reaction: string;
  diagnosedDate: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Medication record
 */
export interface MedicationRecord {
  id: string;
  userId: string;
  clinicId: string;
  name: string;
  dosage: string;
  frequency: string;
  startDate: Date;
  endDate?: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Immunization record
 */
export interface ImmunizationRecord {
  id: string;
  userId: string;
  clinicId: string;
  vaccineName: string;
  dateAdministered: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Radiology report record
 */
export interface RadiologyReportRecord {
  id: string;
  userId: string;
  clinicId: string;
  imageType: string;
  findings: string;
  conclusion: string;
  date: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Surgical record
 */
export interface SurgicalRecord {
  id: string;
  userId: string;
  clinicId: string;
  surgeryName: string;
  surgeon: string;
  date: Date;
  doctorId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

/**
 * Clinic analytics data
 */
export interface ClinicAnalytics {
  totalPatients: number;
  totalMedicalRecords: number;
  totalLabReports: number;
  totalVitals: number;
  activeAllergies: number;
  activeMedications: number;
  recentRecords: number;
  commonConditions: Array<{
    condition: string;
    count: number;
  }>;
  commonAllergies: Array<{
    allergen: string;
    count: number;
  }>;
}

/**
 * Patient summary information
 */
export interface PatientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: Date;
  totalRecords: number;
  lastVisit?: Date;
  activeConditions: number;
  activeMedications: number;
}

/**
 * Search result item for EHR records
 */
export interface SearchResultItem {
  id: string;
  type: 'medicalHistory' | 'labReport' | 'vital' | 'allergy' | 'medication' | 'immunization';
  title: string;
  description: string;
  date: Date;
  userId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

/**
 * Critical alert for patient health
 */
export interface CriticalAlert {
  id: string;
  type: 'allergy' | 'medication' | 'vital' | 'lab';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  patientId: string;
  patientName: string;
  date: Date;
  acknowledged: boolean;
}

// ============================================================================
// PRISMA QUERY RESULT TYPES
// ============================================================================

/**
 * Prisma user select type
 */
export interface PrismaUserSelect {
  id: boolean;
  userId: boolean;
}

/**
 * Prisma count result
 */
export interface PrismaCountResult {
  count: number;
}

/**
 * Prisma group by result
 */
export interface PrismaGroupByResult {
  condition?: string;
  allergen?: string;
  _count: {
    condition?: number;
    allergen?: number;
  };
}

/**
 * Prisma user with relations
 */
export interface PrismaUserWithRelations {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// METHOD RETURN TYPES
// ============================================================================

/**
 * Result from getting clinic records by filter
 */
export interface GetClinicRecordsByFilterResult {
  conditions: MedicalHistoryRecord[];
  allergies: AllergyRecord[];
  medications: MedicationRecord[];
  total: number;
}

/**
 * Result from getting clinic EHR analytics
 */
export interface GetClinicEHRAnalyticsResult {
  totalPatients: number;
  totalMedicalRecords: number;
  totalLabReports: number;
  totalVitals: number;
  activeAllergies: number;
  activeMedications: number;
  recentRecords: number;
  commonConditions: Array<{
    condition: string;
    count: number;
  }>;
  commonAllergies: Array<{
    allergen: string;
    count: number;
  }>;
}

/**
 * Result from getting clinic patients summary
 */
export interface GetClinicPatientsSummaryResult {
  patients: PatientSummary[];
  total: number;
  averageRecordsPerPatient: number;
}

/**
 * Result from searching clinic records
 */
export interface SearchClinicRecordsResult {
  results: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Result from getting clinic critical alerts
 */
export interface GetClinicCriticalAlertsResult {
  alerts: CriticalAlert[];
  total: number;
  unacknowledged: number;
}

/**
 * Filters for clinic EHR records query
 */
export interface ClinicEHRRecordFilters {
  recordType?: string;
  hasCondition?: string;
  hasAllergy?: string;
  onMedication?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

// ============================================================================
// RESPONSE DTO TYPES
// ============================================================================

/**
 * Medical history response DTO
 */
export interface MedicalHistoryResponse {
  id: string;
  userId: string;
  clinicId: string;
  condition: string;
  diagnosis: string;
  treatment: string;
  date: string;
  doctorId: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lab report response DTO
 */
export interface LabReportResponse {
  id: string;
  userId: string;
  clinicId: string;
  testName: string;
  result: string;
  unit: string;
  normalRange: string;
  date: string;
  doctorId: string;
  labName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Vital signs response DTO
 */
export interface VitalResponse {
  id: string;
  userId: string;
  clinicId: string;
  type: string;
  value: number;
  unit: string;
  recordedAt: string;
  doctorId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Allergy response DTO
 */
export interface AllergyResponse {
  id: string;
  userId: string;
  clinicId: string;
  allergen: string;
  severity: string;
  reaction: string;
  diagnosedDate: string;
  doctorId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Medication response DTO
 */
export interface MedicationResponse {
  id: string;
  userId: string;
  clinicId: string;
  name: string;
  dosage: string;
  frequency: string;
  startDate: string;
  endDate?: string;
  doctorId: string;
  prescribedBy: string;
  purpose: string;
  sideEffects: string;
  isActive: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Immunization response DTO
 */
export interface ImmunizationResponse {
  id: string;
  userId: string;
  clinicId: string;
  vaccineName: string;
  dateAdministered: string;
  doctorId: string;
  nextDueDate?: string;
  batchNumber: string;
  administrator: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Radiology report response DTO
 */
export interface RadiologyReportResponse {
  id: string;
  userId: string;
  clinicId: string;
  imageType: string;
  findings: string;
  conclusion: string;
  date: string;
  doctorId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Surgical record response DTO
 */
export interface SurgicalRecordResponse {
  id: string;
  userId: string;
  clinicId: string;
  surgeryName: string;
  surgeon: string;
  date: string;
  doctorId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Family history response DTO
 */
export interface FamilyHistoryResponse {
  id: string;
  userId: string;
  clinicId: string;
  relation: string;
  condition: string;
  doctorId: string;
  diagnosedAge?: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lifestyle assessment response DTO
 */
export interface LifestyleAssessmentResponse {
  id: string;
  userId: string;
  clinicId: string;
  doctorId: string;
  diet?: string;
  exercise?: string;
  smoking?: string;
  alcohol?: string;
  sleep?: string;
  stress?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// BASE ENTITY TYPES (Safe alternatives to Prisma types)
// ============================================================================

/**
 * Base MedicalHistory entity type (safe alternative to Prisma type)
 */
export interface MedicalHistoryBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  condition: string;
  diagnosis?: string | null;
  treatment?: string | null;
  date: Date;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base LabReport entity type (safe alternative to Prisma type)
 */
export interface LabReportBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  testName: string;
  result: string;
  unit?: string | null;
  normalRange?: string | null;
  labName?: string | null;
  doctorId?: string | null;
  notes?: string | null;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base RadiologyReport entity type (safe alternative to Prisma type)
 */
export interface RadiologyReportBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  imageType: string;
  findings: string;
  conclusion: string;
  date: Date;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base SurgicalRecord entity type (safe alternative to Prisma type)
 */
export interface SurgicalRecordBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  surgeryName: string;
  surgeon: string;
  date: Date;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base Vital entity type (safe alternative to Prisma type)
 */
export interface VitalBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  type: string;
  value: string;
  unit?: string | null;
  recordedAt: Date;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base Allergy entity type (safe alternative to Prisma type)
 */
export interface AllergyBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  allergen: string;
  severity: string;
  reaction: string;
  diagnosedDate: Date;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base Medication entity type (safe alternative to Prisma type)
 */
export interface MedicationBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  name: string;
  dosage: string;
  frequency: string;
  startDate: Date;
  endDate?: Date | null;
  prescribedBy: string;
  purpose?: string | null;
  sideEffects?: string | null;
  isActive: boolean;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base Immunization entity type (safe alternative to Prisma type)
 */
export interface ImmunizationBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  vaccineName: string;
  dateAdministered: Date;
  nextDueDate?: Date | null;
  batchNumber?: string | null;
  administrator?: string | null;
  location?: string | null;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base FamilyHistory entity type (safe alternative to Prisma type)
 */
export interface FamilyHistoryBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  relation?: string | null;
  condition: string;
  diagnosedAge?: number | null;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Base LifestyleAssessment entity type (safe alternative to Prisma type)
 */
export interface LifestyleAssessmentBase {
  id: string;
  userId: string;
  clinicId?: string | null;
  diet?: string | null;
  exercise?: string | null;
  smoking?: string | null;
  alcohol?: string | null;
  sleep?: string | null;
  stress?: string | null;
  occupation?: string | null;
  doctorId?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
