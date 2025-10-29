/**
 * Healthcare Application Guards
 * Comprehensive authentication and authorization guards for healthcare applications
 *
 * @module HealthcareGuards
 * @description Guards for healthcare applications including JWT authentication,
 * role-based access control, clinic isolation, and RBAC authorization
 * @example
 * ```typescript
 * import { JwtAuthGuard, RolesGuard, ClinicGuard } from '@libs/core/guards';
 *
 * // Use guards in controllers
 * @Controller('appointments')
 * @UseGuards(JwtAuthGuard, ClinicGuard)
 * @Roles('doctor', 'admin')
 * export class AppointmentsController {
 *   @Get()
 *   async getAppointments() {
 *     // Protected route with JWT auth and clinic context
 *   }
 * }
 * ```
 */

// Main guards
export { JwtAuthGuard } from "./jwt-auth.guard";
export { RolesGuard } from "./roles.guard";
export { ClinicGuard } from "./clinic.guard";

// Module
export { GuardsModule } from "./guards.module";

// Type definitions from JWT Auth Guard
export type {
  User,
  JwtRequestHeaders,
  FastifyRequestWithUser,
  JwtPayload,
  SessionData,
  LockoutStatus,
} from "./jwt-auth.guard";

// Type definitions from Clinic Guard
export type {
  AuthenticatedUser,
  ClinicRequestHeaders,
  ClinicQueryParams,
  ClinicRouteParams,
  ClinicRequestBody,
  ClinicRequestContext,
  ClinicRequest,
  ClinicValidationResult,
} from "./clinic.guard";

// Type definitions from Roles Guard
export type { RequestWithUser } from "./roles.guard";
