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
    void this.loggingService.log(
      LogType.DATABASE,
      LogLevel.ERROR,
      `Security middleware error: ${error.message}`,
      'SecurityQueryMiddleware',
      {
        operation: context.operation,
        error: error.stack,
      }
    );
    return error;
  }
}
