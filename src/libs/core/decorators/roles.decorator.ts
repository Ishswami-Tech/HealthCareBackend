import { SetMetadata } from '@nestjs/common';
import { Role } from '@core/types';

/**
 * Roles metadata key
 */
export const ROLES_KEY = 'roles' as const;

/**
 * Roles decorator for specifying required roles for route access
 *
 * This decorator specifies which roles are required to access a route.
 * It should be used in conjunction with role-based guards to enforce
 * proper authorization based on user roles.
 *
 * @param roles - Array of roles required to access the route
 * @returns Decorator function that sets roles metadata
 *
 * @example
 * ```typescript
 * @Controller('admin')
 * export class AdminController {
 *   @Get('users')
 *   @Roles(Role.ADMIN, Role.SUPER_ADMIN)
 *   async getUsers() {
 *     // Only users with ADMIN or SUPER_ADMIN roles can access this route
 *     return this.usersService.findAll();
 *   }
 * }
 * ```
 */
export const Roles = (...roles: readonly Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
