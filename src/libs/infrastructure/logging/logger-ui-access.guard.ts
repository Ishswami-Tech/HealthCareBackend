import { Injectable, HttpStatus, type CanActivate } from '@nestjs/common';
import { getEnv, isProduction } from '@config/environment/utils';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/** Env flag that re-enables the log/event viewer in production (SUPER_ADMIN-only either way). */
export const LOGGER_UI_ENABLED_ENV = 'LOGGER_UI_ENABLED';

/**
 * Whether the log/event viewer routes are served at all. Log lines and stored events can carry
 * PHI, so production hides them unless an operator explicitly opts in with LOGGER_UI_ENABLED=true.
 */
export function isLoggerUiEnabled(
  production: boolean = isProduction(),
  flag: string | undefined = getEnv(LOGGER_UI_ENABLED_ENV)
): boolean {
  if (!production) {
    return true;
  }
  return (flag ?? '').trim().toLowerCase() === 'true';
}

/**
 * Runs before JwtAuthGuard/RolesGuard: a disabled viewer answers 404 so the route is not even
 * advertised, instead of a 401/403 that confirms it exists.
 */
@Injectable()
export class LoggerUiEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isLoggerUiEnabled()) {
      throw new HealthcareError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Not found',
        HttpStatus.NOT_FOUND,
        {},
        'LoggerUiEnabledGuard'
      );
    }
    return true;
  }
}
