/**
 * RBAC (Role-Based Access Control) Module
 * @module RBAC
 * @description Provides comprehensive role-based access control functionality
 * including permission management, role management, and access validation.
 *
 * This module includes:
 * - Permission management (create, read, update, delete permissions)
 * - Role management (create, read, update, delete roles)
 * - RBAC service for permission checks and role assignments
 * - RBAC guard for protecting routes and endpoints
 * - RBAC decorators for declarative permission requirements
 *
 * @example
 * ```typescript
 * import { RbacModule } from '@rbac';
 *
 * @Module({
 *   imports: [RbacModule],
 *   // ... other module configuration
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * ```typescript
 * import { CanReadUsers, RbacService } from '@rbac';
 *
 * @Controller('users')
 * export class UsersController {
 *   constructor(private readonly rbacService: RbacService) {}
 *
 *   @Get()
 *   @CanReadUsers()
 *   async getUsers() {
 *     // This endpoint requires 'users:read' permission
 *   }
 * }
 * ```
 */

// Core services
export { RbacService } from "./rbac.service";
export { RoleService } from "./role.service";
export { PermissionService } from "./permission.service";

// Guards
export { RbacGuard } from "./rbac.guard";

// Decorators
export { RbacDecorators } from "./rbac.decorators";
export {
  RequirePermission,
  RequireResourcePermission,
  RequireAllPermissions,
  RequireAnyPermission,
  CanReadUsers,
  CanCreateUsers,
  CanUpdateUsers,
  CanDeleteUsers,
  CanManageUsers,
  CanReadAppointments,
  CanCreateAppointments,
  CanUpdateAppointments,
  CanDeleteAppointments,
  CanManageAppointments,
  CanReadPatients,
  CanCreatePatients,
  CanUpdatePatients,
  CanDeletePatients,
  CanManagePatients,
  CanReadMedicalRecords,
  CanCreateMedicalRecords,
  CanUpdateMedicalRecords,
  CanDeleteMedicalRecords,
  CanManageMedicalRecords,
  CanReadPrescriptions,
  CanCreatePrescriptions,
  CanUpdatePrescriptions,
  CanDeletePrescriptions,
  CanManagePrescriptions,
  CanReadClinics,
  CanUpdateClinics,
  CanManageClinics,
  CanReadReports,
  CanCreateReports,
  CanManageReports,
  CanReadSettings,
  CanUpdateSettings,
  CanManageSettings,
  CanReadBilling,
  CanCreateBilling,
  CanUpdateBilling,
  CanManageBilling,
  CanReadProfile,
  CanUpdateProfile,
  CanReadVitals,
  CanCreateVitals,
  CanUpdateVitals,
  CanManageVitals,
  RequireRole,
  RequireSuperAdmin,
  RequireClinicAdmin,
  RequireDoctor,
  RequireNurse,
  RequireReceptionist,
  RequirePatient,
  RequireClinicAccess,
  RequireClinicMembership,
  RequireOwnership,
  RequireAppointmentOwnership,
  RequirePatientOwnership,
  RequireMedicalRecordOwnership,
  RequirePatientOrDoctorAccess,
  RequireAppointmentAccess,
  RequireEmergencyAccess,
  RequireBusinessHoursAccess,
  RequireEmergencyHoursAccess,
} from "./rbac.decorators";

// Module
export { RbacModule } from "./rbac.module";

// Types and interfaces
export type {
  RbacContext,
  RoleAssignment,
  PermissionCheck,
} from "./rbac.service";

export type {
  Role,
  Permission as RolePermission,
  CreateRoleDto,
  UpdateRoleDto,
} from "./role.service";

export type {
  Permission,
  CreatePermissionDto,
  UpdatePermissionDto,
} from "./permission.service";

export type { RbacRequirement } from "./rbac.guard";
