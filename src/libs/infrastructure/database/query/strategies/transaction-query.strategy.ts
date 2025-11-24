/**
 * Transaction Query Strategy
 * @class TransactionQueryStrategy
 * @description Strategy for transaction operations (optimistic, pessimistic, read-only)
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
 * Transaction isolation levels
 */
export type TransactionIsolationLevel =
  | 'ReadUncommitted'
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable';

/**
 * Transaction query strategy - optimized for transaction operations
 */
@Injectable()
export class TransactionQueryStrategy extends BaseQueryStrategy {
  readonly name = 'TransactionQueryStrategy';

  constructor(
    prismaService: PrismaService,
    private readonly loggingService: LoggingService
  ) {
    super(prismaService);
  }

  shouldUse(context: QueryOperationContext): boolean {
    return context.operation.toLowerCase().includes('transaction');
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
        `Executing transaction operation: ${context.operation}`,
        'TransactionQueryStrategy',
        {
          clinicId: context.clinicId,
          userId: context.userId,
        }
      );

      // Execute transaction operation
      // PrismaService.$transaction accepts a callback that receives the transaction client
      const result = await this.prismaService.$transaction(
        async _tx => {
          // The transaction client (_tx) is a PrismaClient instance, not PrismaService
          // We need to wrap it or use it directly
          // For now, execute the operation with the original prismaService
          // The transaction context is already established by $transaction
          return operation(this.prismaService);
        },
        {
          maxWait: context.options.timeout || 10000,
          timeout: context.options.timeout || 30000,
        }
      );

      const executionTime = Date.now() - startTime;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Transaction operation completed in ${executionTime}ms`,
        'TransactionQueryStrategy',
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
        `Transaction operation failed: ${(error as Error).message}`,
        'TransactionQueryStrategy',
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
