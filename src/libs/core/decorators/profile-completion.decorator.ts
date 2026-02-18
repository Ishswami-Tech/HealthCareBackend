import { SetMetadata } from '@nestjs/common';

/**
 * Decorator metadata key for profile completion requirement
 */
export const REQUIRES_PROFILE_COMPLETION_KEY = 'requiresProfileCompletion';

/**
 * Decorator to mark endpoints/routes that require complete user profile
 *
 * @example
 * @UseGuards(JwtAuthGuard, ProfileCompletionGuard)
 * @RequiresProfileCompletion()
 * @Get('appointments')
 * async getAppointments() {
 *   // Only accessible to users with complete profiles
 * }
 *
 * @description Use this decorator on routes/endpoints that should only be accessible
 * to users who have completed their mandatory profile fields. The ProfileCompletionGuard
 * will check the user's profile completion status and deny access if incomplete.
 */
export const RequiresProfileCompletion = () => SetMetadata(REQUIRES_PROFILE_COMPLETION_KEY, true);
