import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "../../infrastructure/database/prisma/prisma.types";
import { ROLES_KEY } from "../decorators/roles.decorator";

/**
 * Request with user interface for role-based access control
 *
 * @interface RequestWithUser
 * @description Defines the structure of requests containing user information
 */
export interface RequestWithUser {
  readonly user?: {
    readonly role?: string;
    readonly [key: string]: unknown;
  };
}

/**
 * Roles Guard for Healthcare Applications
 *
 * @class RolesGuard
 * @implements CanActivate
 * @description Guards routes based on user roles for role-based access control.
 * Validates that the authenticated user has the required role(s) to access the route.
 *
 * @example
 * ```typescript
 * // Use with @UseGuards and @Roles decorators
 * @Controller('admin')
 * @UseGuards(RolesGuard)
 * @Roles('admin', 'super_admin')
 * export class AdminController {
 *   @Get()
 *   async getAdminData() {
 *     // Only users with admin or super_admin roles can access
 *   }
 * }
 * ```
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * Creates a new RolesGuard instance
   *
   * @param reflector - NestJS reflector for metadata access
   */
  constructor(private readonly reflector: Reflector) {}

  /**
   * Determines if the current request can proceed based on user roles
   *
   * @param context - The execution context containing request information
   * @returns True if the user has the required role(s), false otherwise
   * @description Validates user roles against required roles for the route
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) {
      return true;
    }
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const { user } = request;
    return requiredRoles.some((role) => user?.role?.includes(role));
  }
}
