import { Role } from "src/shared/database/prisma/prisma.types";

export type Permission =
  | 'manage_users'
  | 'manage_clinics'
  | 'manage_roles'
  | 'view_analytics'
  | 'manage_system'
  | 'manage_clinic_staff'
  | 'view_clinic_analytics'
  | 'manage_appointments'
  | 'manage_inventory'
  | 'manage_patients'
  | 'view_medical_records'
  | 'create_prescriptions'
  | 'view_appointments'
  | 'book_appointments'
  | 'view_prescriptions'
  | 'view_medical_history'
  | 'register_patients'
  | 'manage_queue'
  | 'basic_patient_info'
  | 'view_profile'
  | 'edit_profile'
  | 'view_clinic_details'
  | 'view_own_appointments';

export type ResourceType = 'clinic' | 'appointment' | 'user' | 'patient' | 'doctor' | 'inventory';

export interface PermissionCheckParams {
  userId: string;
  action: Permission;
  resourceType?: ResourceType;
  resourceId?: string;
  context?: any; // for extensibility (e.g., ownership, tenant, etc.)
}

export interface UserPermissions {
  userId: string;
  roles: Role[];
  permissions: Permission[];
} 