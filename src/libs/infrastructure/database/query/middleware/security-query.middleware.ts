/**
 * Security Query Middleware
 * @class SecurityQueryMiddleware
 * @description SQL injection check, RLS enforcement
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseQueryMiddleware, type QueryMiddlewareContext } from './base-query.middleware';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { SQLInjectionPreventionService } from '@database/internal/sql-injection-prevention.service';
import { RowLevelSecurityService } from '@database/internal/row-level-security.service';

/**
 * Security query middleware - SQL injection check, RLS enforcement
 */
@Injectable()
export class SecurityQueryMiddleware extends BaseQueryMiddleware {
  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SQLInjectionPreventionService))
    private readonly sqlInjectionPrevention: SQLInjectionPreventionService,
    @Inject(forwardRef(() => RowLevelSecurityService))
    private readonly rowLevelSecurity: RowLevelSecurityService
  ) {
    super();
  }

  protected processBefore(context: QueryMiddlewareContext): QueryMiddlewareContext {
    // Check for SQL injection
    if (context.options.where) {
      const whereString = JSON.stringify(context.options.where);

      // Skip SQL injection check for Prisma query operators
      // Prisma uses OR, AND, NOT as valid query operators in JSON format
      // Example: {"OR": [{"doctorId": "..."}, {"patientId": "..."}]}
      // We need to exclude these from SQL injection detection
      const isPrismaQuery = /"(OR|AND|NOT)":\s*\[/.test(whereString);

      if (!isPrismaQuery) {
        const checkResult = this.sqlInjectionPrevention.checkSQLInjection(whereString);
        if (!checkResult.isSafe) {
          void this.loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            'SQL injection attempt detected',
            'SecurityQueryMiddleware',
            {
              operation: context.operation,
              where: context.options.where,
              detectedPatterns: checkResult.detectedPatterns,
            }
          );
          throw new Error('SQL injection attempt detected');
        }
      }
    }

    // Enforce row-level security if enabled
    if (context.options.rowLevelSecurity !== false && context.clinicId) {
      // RLS will be enforced by RowLevelSecurityService
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `RLS enforcement enabled for clinic: ${context.clinicId}`,
        'SecurityQueryMiddleware'
      );
    }

    return context;
  }

  protected processAfter<T>(_context: QueryMiddlewareContext, result: T): T {
    return result;
  }

  protected processError(context: QueryMiddlewareContext, error: Error): Error {
    // Only log at DEBUG level to reduce log spam - main error is logged at DatabaseService level
    // Check if error is already marked as logged to prevent duplicate logging
    const errorAny = error as Error & { _loggedByMiddleware?: boolean };
    if (!errorAny._loggedByMiddleware) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Security middleware error: ${error.message}`,
        'SecurityQueryMiddleware',
        {
          operation: context.operation,
          error: error.stack,
        }
      );
      errorAny._loggedByMiddleware = true;
    }
    return error;
  }
}
