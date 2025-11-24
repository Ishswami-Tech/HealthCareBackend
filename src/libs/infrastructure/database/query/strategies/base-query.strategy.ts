/**
 * Base Query Strategy
 * @class BaseQueryStrategy
 * @description Base implementation for query strategies
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable } from '@nestjs/common';
import type { QueryOptions } from '@core/types/database.types';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Query operation context
 */
export interface QueryOperationContext {
  operation: string;
  options: QueryOptions;
  clinicId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Query strategy interface
 */
export interface IQueryStrategy {
  readonly name: string;
  execute<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    context: QueryOperationContext
  ): Promise<T>;
  shouldUse(context: QueryOperationContext): boolean;
}

/**
 * Base query strategy with common functionality
 */
@Injectable()
export abstract class BaseQueryStrategy implements IQueryStrategy {
  constructor(protected readonly prismaService: PrismaService) {}

  abstract readonly name: string;

  abstract execute<T>(
    operation: (prisma: PrismaService) => Promise<T>,
    context: QueryOperationContext
  ): Promise<T>;

  abstract shouldUse(context: QueryOperationContext): boolean;

  /**
   * Determine if operation is read-only
   */
  protected isReadOperation(operation: string): boolean {
    const readOps = ['find', 'get', 'read', 'select', 'query'];
    return readOps.some(op => operation.toLowerCase().includes(op));
  }

  /**
   * Determine if operation is write operation
   */
  protected isWriteOperation(operation: string): boolean {
    const writeOps = ['create', 'update', 'delete', 'insert', 'upsert', 'modify'];
    return writeOps.some(op => operation.toLowerCase().includes(op));
  }

  /**
   * Determine if operation is critical
   */
  protected isCriticalOperation(context: QueryOperationContext): boolean {
    return context.options.priority === 'critical';
  }

  /**
   * Determine if operation contains PHI
   */
  protected containsPHI(context: QueryOperationContext): boolean {
    return context.options.hipaaCompliant === true;
  }
}
