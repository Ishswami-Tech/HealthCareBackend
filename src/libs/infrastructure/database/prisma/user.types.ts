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
  Clinic,
  AuditLog,
} from "./prisma.types";

export interface UserWithRelations extends User {
  doctor?: Doctor | null;
  patient?: Patient | null;
  receptionists?: Receptionist[];
  clinicAdmins?: ClinicAdmin[];
  superAdmin?: SuperAdmin | null;
  pharmacist?: Pharmacist | null;
  therapist?: Therapist | null;
  labTechnician?: LabTechnician | null;
  financeBilling?: FinanceBilling | null;
  supportStaff?: SupportStaff | null;
  nurse?: Nurse | null;
  counselor?: Counselor | null;
}

export interface UserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zipCode?: string | null;
  role: string;
  isActive: boolean;
  lastLogin?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  doctor?: Doctor | null;
  patient?: Patient | null;
  receptionists?: Receptionist[];
  clinicAdmins?: ClinicAdmin[];
  superAdmin?: SuperAdmin | null;
  pharmacist?: Pharmacist | null;
  therapist?: Therapist | null;
  labTechnician?: LabTechnician | null;
  financeBilling?: FinanceBilling | null;
  supportStaff?: SupportStaff | null;
  nurse?: Nurse | null;
  counselor?: Counselor | null;
}

export interface PrismaError extends Error {
  code?: string;
  meta?: {
    target?: string[];
    cause?: string;
  };
}
