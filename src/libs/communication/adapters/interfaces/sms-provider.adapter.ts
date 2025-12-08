/**
 * SMS Provider Adapter Interface
 * ===============================
 * Base interface for all SMS provider adapters
 * Follows Strategy pattern for provider-agnostic SMS delivery
 *
 * @module SMSProviderAdapter
 * @description SMS provider adapter interface
 */

/**
 * SMS Options
 */
export interface SMSOptions {
  to: string; // Phone number with country code
  from?: string; // Sender number (optional, uses default)
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * SMS Result
 */
export interface SMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
  timestamp: Date;
}

import type { ProviderHealthStatus } from './provider-health-status.types';

export type { ProviderHealthStatus };

/**
 * SMS Provider Adapter Interface
 * All SMS providers must implement this interface
 */
export interface SMSProviderAdapter {
  /**
   * Send an SMS
   */
  send(options: SMSOptions): Promise<SMSResult>;

  /**
   * Verify provider connection/credentials
   */
  verify(): Promise<boolean>;

  /**
   * Get provider health status
   */
  getHealthStatus(): Promise<ProviderHealthStatus>;

  /**
   * Get provider name
   */
  getProviderName(): string;
}
