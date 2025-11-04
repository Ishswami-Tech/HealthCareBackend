/**
 * Enterprise Core Library
 *
 * Provides core functionality for the healthcare platform including:
 * - Business rules engine
 * - Plugin interface system
 * - Decorators, guards, and filters
 * - RBAC and session management
 * - Type definitions
 */

// Business Rules Engine
export * from './business-rules/business-rules-engine.service';

// Plugin Interface System
export * from './plugin-interface';

// Error Handling
export * from './errors';

// Decorators
export * from './decorators/clinic-route.decorator';
export * from './decorators/clinic.decorator';
export * from './decorators/public.decorator';
export * from './decorators/roles.decorator';

// Filters
export * from './filters/http-exception.filter';

// Guards
export { ClinicGuard } from './guards/clinic.guard';
export * from './guards/guards.module';
export { JwtAuthGuard } from './guards/jwt-auth.guard';
export * from './rbac/rbac.guard';
export * from './guards/roles.guard';

// Pipes
export * from './pipes/validation.pipe';

// RBAC
export { PermissionService } from './rbac/permission.service';
export type { Permission as RBACPermission } from './rbac/permission.service';
export { Permission as RolePermission, RoleService } from './rbac/role.service';
export type { RoleRecord as Role } from './rbac/role.service';
export * from './rbac/rbac.decorators';
export * from './rbac/rbac.guard';
export * from './rbac/rbac.module';
export * from './rbac/rbac.service';

// Session Management
export * from './session/session-management.service';
export * from './session/session.module';

// Types (excluding SessionData to avoid conflict with session service)
export * from './types/queue.types';
export * from './types/clinic.types';
