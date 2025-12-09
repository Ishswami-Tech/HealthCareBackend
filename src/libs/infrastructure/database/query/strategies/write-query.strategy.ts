/**
 * Write Query Strategy
 * @class WriteQueryStrategy
 * @description Strategy for write operations (audit, critical, batch)
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BaseQueryStrategy, type QueryOperationContext } from './base-query.strategy';
import { PrismaService } from '@database/prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Write query strategy - optimized for write operations with audit trails
 */
@Injectable()
export class WriteQueryStrategy extends BaseQueryStrategy {
  readonly name = 'WriteQueryStrategy';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    prismaService: PrismaService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    super(prismaService);
  }

  shouldUse(context: QueryOperationContext): boolean {
    return this.isWriteOperation(context.operation);
  }

  async execute<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    context: QueryOperationContext
  ): Promise<T> {
    const startTime = Date.now();

    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Executing write operation: ${context.operation}`,
        'WriteQueryStrategy',
        {
          clinicId: context.clinicId,
          userId: context.userId,
          auditRequired: context.options.auditRequired,
        }
      );

      // Execute write operation
      const result = await operation(this.prismaService);

      const executionTime = Date.now() - startTime;

      // Log audit trail if required
      if (context.options.auditRequired !== false) {
        void this.loggingService.log(
          LogType.AUDIT,
          LogLevel.INFO,
          `Write operation completed: ${context.operation}`,
          'WriteQueryStrategy',
          {
            operation: context.operation,
            clinicId: context.clinicId,
            userId: context.userId,
            executionTime,
            timestamp: new Date().toISOString(),
          }
        );
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Write operation completed in ${executionTime}ms`,
        'WriteQueryStrategy',
        {
          operation: context.operation,
          executionTime,
        }
      );

      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Write operation failed: ${(error as Error).message}`,
        'WriteQueryStrategy',
        {
          operation: context.operation,
          executionTime,
          error: (error as Error).stack,
        }
      );
      throw error;
    }
  }
}
