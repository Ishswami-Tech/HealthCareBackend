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
export { JwtAuthGuard } from './jwt-auth.guard';
export { RolesGuard } from './roles.guard';
export { ClinicGuard } from './clinic.guard';

// Module
export { GuardsModule } from './guards.module';

// All types are now in @core/types/guard.types.ts and @core/types/session.types.ts
export type {
  AuthenticatedUser,
  JwtGuardUser as User,
  ClinicRequestHeaders,
  JwtRequestHeaders,
  ClinicQueryParams,
  ClinicRouteParams,
  ClinicRequestBody,
  ClinicRequestContext,
  ClinicRequest,
  ClinicValidationResult,
  FastifyRequestWithUser,
  JwtPayload,
  RequestWithUser,
  RequestWithAuth,
} from '@core/types/guard.types';
export type { RedisSessionData as SessionData, LockoutStatus } from '@core/types/session.types';
