/**
 * Transaction Options Builder
 * @class TransactionOptionsBuilder
 * @description Builder pattern for constructing transaction options
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

/**
 * Transaction isolation levels
 */
export type TransactionIsolationLevel =
  | 'ReadUncommitted'
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable';

/**
 * Transaction options
 */
export interface TransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: TransactionIsolationLevel;
  readOnly?: boolean;
}

/**
 * Builder for transaction options
 */
export class TransactionOptionsBuilder {
  private options: TransactionOptions = {};

  /**
   * Set max wait time
   */
  maxWait(ms: number): this {
    this.options.maxWait = ms;
    return this;
  }

  /**
   * Set timeout
   */
  timeout(ms: number): this {
    this.options.timeout = ms;
    return this;
  }

  /**
   * Set isolation level
   */
  isolationLevel(level: TransactionIsolationLevel): this {
    this.options.isolationLevel = level;
    return this;
  }

  /**
   * Set read-only
   */
  readOnly(readOnly = true): this {
    this.options.readOnly = readOnly;
    return this;
  }

  /**
   * Build transaction options
   */
  build(): TransactionOptions {
    return { ...this.options };
  }

  /**
   * Reset builder
   */
  reset(): this {
    this.options = {};
    return this;
  }
}
