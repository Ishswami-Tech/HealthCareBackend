/**
 * Read Query Strategy
 * @class ReadQueryStrategy
 * @description Strategy for read operations (optimized, cached, replica)
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable } from '@nestjs/common';
import { BaseQueryStrategy, type QueryOperationContext } from './base-query.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Read query strategy - optimized for read operations
 */
@Injectable()
export class ReadQueryStrategy extends BaseQueryStrategy {
  readonly name = 'ReadQueryStrategy';

  constructor(
    prismaService: PrismaService,
    private readonly loggingService: LoggingService
  ) {
    super(prismaService);
  }

  shouldUse(context: QueryOperationContext): boolean {
    return this.isReadOperation(context.operation);
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
        `Executing read operation: ${context.operation}`,
        'ReadQueryStrategy',
        {
          clinicId: context.clinicId,
          userId: context.userId,
        }
      );

      // Execute read operation
      const result = await operation(this.prismaService);

      const executionTime = Date.now() - startTime;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Read operation completed in ${executionTime}ms`,
        'ReadQueryStrategy',
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
        `Read operation failed: ${(error as Error).message}`,
        'ReadQueryStrategy',
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
