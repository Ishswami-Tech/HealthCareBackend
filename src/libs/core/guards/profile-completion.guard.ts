import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequestWithUser, JwtGuardUser } from '@core/types/guard.types';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import { ProfileCompletionService } from '@services/profile-completion/profile-completion.service';
import { REQUIRES_PROFILE_COMPLETION_KEY } from '@core/decorators/profile-completion.decorator';

/**
 * Profile Completion Guard
 *
 * Enforces mandatory profile completion for protected routes.
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, ProfileCompletionGuard)
 * @RequiresProfileCompletion()
 * @Get('protected-resource')
 * async getProtectedResource() {
 *   // Only users with complete profiles can access this endpoint
 * }
 *
 * @class ProfileCompletionGuard
 * @implements CanActivate
 * @description Validates that authenticated users have completed their mandatory profile fields.
 * Backend enforcement - single source of truth for profile completion status.
 */
@Injectable()
export class ProfileCompletionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    private readonly logging: LoggingService,
    @Inject(forwardRef(() => ProfileCompletionService))
    private readonly profileCompletionService: ProfileCompletionService
  ) {}

  /**
   * Determines if the current request can proceed based on profile completion status
   *
   * @param context - The execution context containing request information
   * @returns Promise<boolean> - True if profile is complete or completion is not required
   * @throws ForbiddenException - When profile is incomplete and completion is required
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      // Check if this endpoint requires profile completion
      const requiresProfileCompletion = this.reflector.getAllAndOverride<boolean>(
        REQUIRES_PROFILE_COMPLETION_KEY,
        [context.getHandler(), context.getClass()]
      );

      // If profile completion is not required for this endpoint, allow access
      if (!requiresProfileCompletion) {
        return true;
      }

      const request = context.switchToHttp().getRequest<FastifyRequestWithUser>();
      const user = request.user as JwtGuardUser;

      // Must be authenticated first (handled by JwtAuthGuard)
      if (!user || !user.id) {
        throw new UnauthorizedException('Authentication required');
      }

      // Get user from database to check profile completion status
      const dbUser = await this.databaseService.findUserByIdSafe(user.id);

      if (!dbUser) {
        throw new UnauthorizedException('User not found');
      }

      // Check database-level flag (authoritative)
      const isProfileComplete = dbUser.isProfileComplete;

      if (!isProfileComplete) {
        await this.logging.log(
          LogType.AUDIT,
          LogLevel.DEBUG,
          `Access denied: User ${user.id} attempted to access protected resource with incomplete profile`,
          'ProfileCompletionGuard.canActivate',
          {
            userId: user.id,
            email: user.email,
            role: user.role,
            path: request.raw?.url,
            method: request.method,
          }
        );

        throw new ForbiddenException({
          error: 'Profile Incomplete',
          message: 'Please complete your profile to access this feature',
          requiresProfileCompletion: true,
          redirectUrl: '/profile/complete',
        });
      }

      // Optionally validate with ProfileCompletionService to ensure consistency
      const validation = this.profileCompletionService.validateProfileCompletion(
        dbUser as unknown as Record<string, unknown>,
        (user.role as Role) || Role.PATIENT
      );

      if (!validation.isComplete) {
        await this.logging.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Profile completion status mismatch for user ${user.id}: DB flag=true, Validation=false`,
          'ProfileCompletionGuard.canActivate',
          {
            userId: user.id,
            missingFields: validation.missingFields,
            errorCount: validation.errors.length,
          }
        );

        // Update database flag to reflect actual completion status
        await this.databaseService.updateUserSafe(user.id, {
          isProfileComplete: false,
        } as never);

        throw new ForbiddenException({
          error: 'Profile Incomplete',
          message: 'Please complete your profile to access this feature',
          requiresProfileCompletion: true,
          redirectUrl: '/profile/complete',
          missingFields: validation.missingFields,
        });
      }

      await this.logging.log(
        LogType.AUDIT,
        LogLevel.DEBUG,
        `Profile completion check passed for user ${user.id}`,
        'ProfileCompletionGuard.canActivate',
        {
          userId: user.id,
          role: user.role,
          path: request.raw?.url,
        }
      );

      return true;
    } catch (error) {
      // Re-throw ForbiddenException and UnauthorizedException
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
        throw error;
      }

      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error in ProfileCompletionGuard: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ProfileCompletionGuard.canActivate',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      throw new UnauthorizedException('Profile verification failed');
    }
  }
}
