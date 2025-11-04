/**
 * Permissions decorator for role-based access control
 *
 * This decorator provides fine-grained permission-based access control
 * for route handlers, allowing specification of specific permissions
 * required to access a route.
 *
 * @module PermissionsDecorator
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Permissions metadata key
 */
export const PERMISSIONS_KEY = 'permissions' as const;

/**
 * Permission types for healthcare operations
 */
export type Permission =
  | 'appointments:read'
  | 'appointments:write'
  | 'appointments:delete'
  | 'patients:read'
  | 'patients:write'
  | 'patients:delete'
  | 'prescriptions:read'
  | 'prescriptions:write'
  | 'prescriptions:delete'
  | 'billing:read'
  | 'billing:write'
  | 'billing:delete'
  | 'users:read'
  | 'users:write'
  | 'users:delete'
  | 'clinics:read'
  | 'clinics:write'
  | 'clinics:delete'
  | 'reports:read'
  | 'reports:write'
  | 'settings:read'
  | 'settings:write'
  | 'audit:read'
  | 'audit:write';

/**
 * Permissions decorator for specifying required permissions for route access
 *
 * This decorator specifies which permissions are required to access a route.
 * It provides fine-grained access control beyond role-based authorization,
 * allowing for specific permission checks.
 *
 * @param permissions - Array of permissions required to access the route
 * @returns Decorator function that sets permissions metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Get()
 *   @Permissions('appointments:read')
 *   async getAppointments() {
 *     // Only users with 'appointments:read' permission can access this route
 *     return this.appointmentsService.findAll();
 *   }
 *
 *   @Post()
 *   @Permissions('appointments:write')
 *   async createAppointment(@Body() createDto: CreateAppointmentDto) {
 *     // Only users with 'appointments:write' permission can access this route
 *     return this.appointmentsService.create(createDto);
 *   }
 * }
 * ```
 */
export const Permissions = (
  ...permissions: readonly Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Single permission decorator for convenience
 *
 * @param permission - Single permission required to access the route
 * @returns Decorator function that sets permissions metadata
 *
 * @example
 * ```typescript
 * @Get('patients')
 * @Permission('patients:read')
 * async getPatients() {
 *   return this.patientsService.findAll();
 * }
 * ```
 */
export const Permission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, [permission]);
