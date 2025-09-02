import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route handler as a clinic-specific route.
 * This will ensure that the ClinicGuard validates tenant access and scope.
 */
export const ClinicRoute = () => SetMetadata('isClinicRoute', true); 