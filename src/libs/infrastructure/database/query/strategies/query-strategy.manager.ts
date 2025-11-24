/**
 * Query Strategy Manager
 * @class QueryStrategyManager
 * @description Manages and selects appropriate query strategy
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { type IQueryStrategy, type QueryOperationContext } from './base-query.strategy';
import { ReadQueryStrategy } from './read-query.strategy';
import { WriteQueryStrategy } from './write-query.strategy';
import { TransactionQueryStrategy } from './transaction-query.strategy';
import type { PrismaService } from '../../prisma/prisma.service';
import { LoggingService } from '@infrastructure/logging';

/**
 * Query strategy manager - selects and executes appropriate strategy
 */
@Injectable()
export class QueryStrategyManager {
  private readonly strategies: IQueryStrategy[];

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Initialize strategies in priority order
    this.strategies = [
      new TransactionQueryStrategy(this.prismaService, this.loggingService),
      new WriteQueryStrategy(this.prismaService, this.loggingService),
      new ReadQueryStrategy(this.prismaService, this.loggingService), // Fallback
    ];
  }

  /**
   * Get appropriate strategy for given context
   */
  getStrategy(context: QueryOperationContext): IQueryStrategy {
    // Find first strategy that should be used
    const strategy = this.strategies.find(s => s.shouldUse(context));

    if (!strategy) {
      // Fallback to read strategy (always exists as last element)
      const fallback = this.strategies[this.strategies.length - 1];
      if (!fallback) {
        throw new Error('No query strategy available');
      }
      return fallback;
    }

    return strategy;
  }

  /**
   * Execute query operation with appropriate strategy
   */
  async execute<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    context: QueryOperationContext
  ): Promise<T> {
    const strategy = this.getStrategy(context);
    return strategy.execute(operation, context);
  }
}
