import { SetMetadata } from "@nestjs/common";

/**
 * Clinic route metadata key
 */
export const CLINIC_ROUTE_KEY = "isClinicRoute" as const;

/**
 * Clinic route decorator for marking routes that require clinic-specific validation
 *
 * This decorator marks a route handler as a clinic-specific route that requires
 * special validation by the ClinicGuard. The guard will validate tenant access
 * and scope based on the clinic context.
 *
 * @returns Decorator function that sets clinic route metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Get()
 *   @ClinicRoute()
 *   async getAppointments(@ClinicId() clinicId: string) {
 *     // This route will be validated by ClinicGuard
 *     return this.appointmentsService.findByClinic(clinicId);
 *   }
 * }
 * ```
 */
export const ClinicRoute = (): MethodDecorator =>
  SetMetadata(CLINIC_ROUTE_KEY, true);
