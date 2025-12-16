/**
 * Row Level Security Service
 * @class RowLevelSecurityService
 * @description Enforces row-level security for multi-tenant data isolation
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface RLSContext {
  clinicId?: string;
  userId?: string;
  role?: string;
}

/**
 * Row level security service
 * @internal
 */
@Injectable()
export class RowLevelSecurityService {
  private readonly serviceName = 'RowLevelSecurityService';
  private readonly enabled: boolean;

  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.enabled = this.configService.get<boolean>('database.rowLevelSecurity.enabled') ?? true;
  }

  /**
   * Apply RLS filters to query
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  applyRLSFilter<T extends Record<string, unknown>>(where: T, context: RLSContext): T {
    if (!this.enabled) {
      return where;
    }

    // Add clinicId filter if context has clinicId
    if (context.clinicId && !('clinicId' in where)) {
      return {
        ...where,
        clinicId: context.clinicId,
      };
    }

    return where;
  }

  /**
   * Validate RLS access
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  validateAccess(resourceClinicId: string | null | undefined, context: RLSContext): boolean {
    if (!this.enabled) {
      return true;
    }

    // Super admin bypass
    if (context.role === 'SUPER_ADMIN') {
      return true;
    }

    // If resource has no clinicId, allow access
    if (!resourceClinicId) {
      return true;
    }

    // Check if user's clinic matches resource clinic
    if (context.clinicId && context.clinicId === resourceClinicId) {
      return true;
    }

    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.WARN,
      `RLS access denied: user ${context.userId} from clinic ${context.clinicId} attempted to access resource from clinic ${resourceClinicId}`,
      this.serviceName,
      { context, resourceClinicId }
    );

    return false;
  }

  /**
   * Set RLS context for Prisma
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  setRLSContext(context: RLSContext): void {
    if (!this.enabled) {
      return;
    }

    // Prisma RLS is typically handled via middleware or query modifications
    // This method can be extended to set session variables or query context
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.DEBUG,
      `RLS context set: clinicId=${context.clinicId}, userId=${context.userId}`,
      this.serviceName,
      { context }
    );
  }
}
