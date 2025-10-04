import { SetMetadata, applyDecorators } from "@nestjs/common";
import { UseGuards } from "@nestjs/common";
import { RbacGuard, RbacRequirement } from "./rbac.guard";

export const RBAC_METADATA_KEY = "rbac";

/**
 * Base RBAC decorator
 */
export const RequirePermission = (...requirements: RbacRequirement[]) =>
  applyDecorators(
    SetMetadata(RBAC_METADATA_KEY, requirements),
    UseGuards(RbacGuard),
  );

/**
 * Require specific resource and action permissions
 */
export const RequireResourcePermission = (
  resource: string,
  action: string,
  options?: {
    clinicId?: string;
    requireOwnership?: boolean;
    allowSuperAdmin?: boolean;
  },
) =>
  RequirePermission({
    resource,
    action,
    clinicId: options?.clinicId,
    requireOwnership: options?.requireOwnership,
    allowSuperAdmin: options?.allowSuperAdmin !== false,
  });

/**
 * Require multiple permissions (all must be satisfied)
 */
export const RequireAllPermissions = (
  ...permissions: Array<{ resource: string; action: string }>
) =>
  RequirePermission(
    ...permissions.map((p) => ({ resource: p.resource, action: p.action })),
  );

/**
 * Require any of the specified permissions (at least one must be satisfied)
 */
export const RequireAnyPermission = (
  ...permissions: Array<{ resource: string; action: string }>
) =>
  RequirePermission({
    resource: permissions[0].resource,
    action: permissions[0].action,
  });

// Convenience decorators for common permissions

/**
 * User management permissions
 */
export const CanReadUsers = () => RequireResourcePermission("users", "read");
export const CanCreateUsers = () =>
  RequireResourcePermission("users", "create");
export const CanUpdateUsers = () =>
  RequireResourcePermission("users", "update");
export const CanDeleteUsers = () =>
  RequireResourcePermission("users", "delete");
export const CanManageUsers = () => RequireResourcePermission("users", "*");

/**
 * Appointment permissions
 */
export const CanReadAppointments = () =>
  RequireResourcePermission("appointments", "read");
export const CanCreateAppointments = () =>
  RequireResourcePermission("appointments", "create");
export const CanUpdateAppointments = () =>
  RequireResourcePermission("appointments", "update");
export const CanDeleteAppointments = () =>
  RequireResourcePermission("appointments", "delete");
export const CanManageAppointments = () =>
  RequireResourcePermission("appointments", "*");

/**
 * Patient permissions
 */
export const CanReadPatients = () =>
  RequireResourcePermission("patients", "read");
export const CanCreatePatients = () =>
  RequireResourcePermission("patients", "create");
export const CanUpdatePatients = () =>
  RequireResourcePermission("patients", "update");
export const CanDeletePatients = () =>
  RequireResourcePermission("patients", "delete");
export const CanManagePatients = () =>
  RequireResourcePermission("patients", "*");

/**
 * Medical records permissions
 */
export const CanReadMedicalRecords = () =>
  RequireResourcePermission("medical-records", "read");
export const CanCreateMedicalRecords = () =>
  RequireResourcePermission("medical-records", "create");
export const CanUpdateMedicalRecords = () =>
  RequireResourcePermission("medical-records", "update");
export const CanDeleteMedicalRecords = () =>
  RequireResourcePermission("medical-records", "delete");
export const CanManageMedicalRecords = () =>
  RequireResourcePermission("medical-records", "*");

/**
 * Prescription permissions
 */
export const CanReadPrescriptions = () =>
  RequireResourcePermission("prescriptions", "read");
export const CanCreatePrescriptions = () =>
  RequireResourcePermission("prescriptions", "create");
export const CanUpdatePrescriptions = () =>
  RequireResourcePermission("prescriptions", "update");
export const CanDeletePrescriptions = () =>
  RequireResourcePermission("prescriptions", "delete");
export const CanManagePrescriptions = () =>
  RequireResourcePermission("prescriptions", "*");

/**
 * Clinic management permissions
 */
export const CanReadClinics = () =>
  RequireResourcePermission("clinics", "read");
export const CanUpdateClinics = () =>
  RequireResourcePermission("clinics", "update");
export const CanManageClinics = () => RequireResourcePermission("clinics", "*");

/**
 * Reports permissions
 */
export const CanReadReports = () =>
  RequireResourcePermission("reports", "read");
export const CanCreateReports = () =>
  RequireResourcePermission("reports", "create");
export const CanManageReports = () => RequireResourcePermission("reports", "*");

/**
 * Settings permissions
 */
export const CanReadSettings = () =>
  RequireResourcePermission("settings", "read");
export const CanUpdateSettings = () =>
  RequireResourcePermission("settings", "update");
export const CanManageSettings = () =>
  RequireResourcePermission("settings", "*");

/**
 * Billing permissions
 */
export const CanReadBilling = () =>
  RequireResourcePermission("billing", "read");
export const CanCreateBilling = () =>
  RequireResourcePermission("billing", "create");
export const CanUpdateBilling = () =>
  RequireResourcePermission("billing", "update");
export const CanManageBilling = () => RequireResourcePermission("billing", "*");

/**
 * Profile permissions (with ownership check)
 */
export const CanReadProfile = () =>
  RequireResourcePermission("profile", "read", { requireOwnership: true });
export const CanUpdateProfile = () =>
  RequireResourcePermission("profile", "update", { requireOwnership: true });

/**
 * Vitals permissions
 */
export const CanReadVitals = () => RequireResourcePermission("vitals", "read");
export const CanCreateVitals = () =>
  RequireResourcePermission("vitals", "create");
export const CanUpdateVitals = () =>
  RequireResourcePermission("vitals", "update");
export const CanManageVitals = () => RequireResourcePermission("vitals", "*");

/**
 * Role-based decorators
 */
export const RequireRole = (_role: string) =>
  RequireResourcePermission("roles", "check", { clinicId: undefined });

export const RequireSuperAdmin = () =>
  RequireResourcePermission("*", "*", { allowSuperAdmin: true });

export const RequireClinicAdmin = () =>
  RequireAllPermissions(
    { resource: "clinics", action: "read" },
    { resource: "users", action: "read" },
  );

export const RequireDoctor = () =>
  RequireAllPermissions(
    { resource: "appointments", action: "read" },
    { resource: "patients", action: "read" },
  );

export const RequireNurse = () =>
  RequireAllPermissions(
    { resource: "appointments", action: "read" },
    { resource: "vitals", action: "create" },
  );

export const RequireReceptionist = () =>
  RequireAllPermissions(
    { resource: "appointments", action: "create" },
    { resource: "patients", action: "read" },
  );

export const RequirePatient = () =>
  RequireAllPermissions(
    { resource: "appointments", action: "read" },
    { resource: "profile", action: "read" },
  );

/**
 * Clinic-specific decorators
 */
export const RequireClinicAccess = (clinicId?: string) =>
  RequireResourcePermission("clinics", "access", { clinicId });

export const RequireClinicMembership = () =>
  RequireResourcePermission("clinics", "member");

/**
 * Ownership-based decorators
 */
export const RequireOwnership = (resource: string, action: string) =>
  RequireResourcePermission(resource, action, { requireOwnership: true });

export const RequireAppointmentOwnership = (action: string) =>
  RequireOwnership("appointments", action);

export const RequirePatientOwnership = (action: string) =>
  RequireOwnership("patients", action);

export const RequireMedicalRecordOwnership = (action: string) =>
  RequireOwnership("medical-records", action);

/**
 * Combined permission decorators
 */
export const RequirePatientOrDoctorAccess = () =>
  RequireAnyPermission(
    { resource: "patients", action: "read" },
    { resource: "medical-records", action: "read" },
  );

export const RequireAppointmentAccess = () =>
  RequireAnyPermission(
    { resource: "appointments", action: "read" },
    { resource: "appointments", action: "create" },
    { resource: "appointments", action: "update" },
  );

export const RequireEmergencyAccess = () =>
  RequireResourcePermission("emergency", "access", { allowSuperAdmin: true });

/**
 * Time-sensitive permission decorators
 */
export const RequireBusinessHoursAccess = () =>
  RequireResourcePermission("access", "business-hours");

export const RequireEmergencyHoursAccess = () =>
  RequireResourcePermission("access", "emergency-hours");

/**
 * Utility class for RBAC decorators
 */
export class RbacDecorators {
  /**
   * Create custom permission decorator
   */
  static createPermissionDecorator(
    resource: string,
    action: string,
    options?: {
      clinicId?: string;
      requireOwnership?: boolean;
      allowSuperAdmin?: boolean;
    },
  ) {
    return RequireResourcePermission(resource, action, options);
  }

  /**
   * Create role-specific decorator
   */
  static createRoleDecorator(roles: string[]) {
    return RequirePermission(
      ...roles.map((role) => ({
        resource: "roles",
        action: role.toLowerCase(),
      })),
    );
  }

  /**
   * Create clinic-specific decorator
   */
  static createClinicDecorator(
    clinicId: string,
    resource: string,
    action: string,
  ) {
    return RequireResourcePermission(resource, action, { clinicId });
  }
}
