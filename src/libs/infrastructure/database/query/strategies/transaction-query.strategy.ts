/**
 * Transaction Query Strategy
 * @class TransactionQueryStrategy
 * @description Strategy for transaction operations (optimistic, pessimistic, read-only)
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
 * Transaction isolation levels
 */
export type TransactionIsolationLevel =
  'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

/**
 * Transaction query strategy - optimized for transaction operations
 */
@Injectable()
export class TransactionQueryStrategy extends BaseQueryStrategy {
  readonly name = 'TransactionQueryStrategy';

  constructor(
    @Inject(forwardRef(() => PrismaService))
    prismaService: PrismaService,
    @Inject(forwardRef(() => LoggingService))
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
      // PrismaService.$transaction accepts a callback that receives the transaction
      // client (tx) - a PrismaClient scoped to this transaction's single pinned
      // connection. Operations MUST run against tx, not the shared prismaService,
      // otherwise they execute as independent, non-atomic queries against the
      // normal pool and none of the transaction's rollback-on-error guarantees
      // apply. toTransactionClient() (database.service.ts) recognizes this raw
      // client and passes it through as-is instead of calling getRawPrismaClient().
      const result = await this.prismaService.$transaction(
        async tx => {
          return operation(tx as unknown as PrismaService);
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
