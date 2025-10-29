// EHR Service Type Definitions
// This file contains all the type definitions needed for the EHR service to eliminate `any` types

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

// Analytics types
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

export interface SearchResultItem {
  id: string;
  type:
    | "medicalHistory"
    | "labReport"
    | "vital"
    | "allergy"
    | "medication"
    | "immunization";
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

export interface CriticalAlert {
  id: string;
  type: "allergy" | "medication" | "vital" | "lab";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  patientId: string;
  patientName: string;
  date: Date;
  acknowledged: boolean;
}

// Prisma query result types
export interface PrismaUserSelect {
  id: boolean;
  userId: boolean;
}

export interface PrismaCountResult {
  count: number;
}

export interface PrismaGroupByResult {
  condition?: string;
  allergen?: string;
  _count: {
    condition?: number;
    allergen?: number;
  };
}

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

// Method return types
export interface GetClinicRecordsByFilterResult {
  conditions: MedicalHistoryRecord[];
  allergies: AllergyRecord[];
  medications: MedicationRecord[];
  total: number;
}

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

export interface GetClinicPatientsSummaryResult {
  patients: PatientSummary[];
  total: number;
  averageRecordsPerPatient: number;
}

export interface SearchClinicRecordsResult {
  results: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
}

export interface GetClinicCriticalAlertsResult {
  alerts: CriticalAlert[];
  total: number;
  unacknowledged: number;
}

// Response DTOs for API responses
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
