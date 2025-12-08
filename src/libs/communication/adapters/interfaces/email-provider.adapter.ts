/**
 * Email Provider Adapter Interface
 * ================================
 * Base interface for all email provider adapters
 * Follows Strategy pattern for provider-agnostic email delivery
 *
 * @module EmailProviderAdapter
 * @description Email provider adapter interface
 */

/**
 * Email Options
 */
export interface EmailOptions {
  to: string | string[];
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  html?: boolean;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * Email Result
 */
export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
  timestamp: Date;
}

import type { ProviderHealthStatus } from './provider-health-status.types';

export type { ProviderHealthStatus };

/**
 * Email Provider Adapter Interface
 * All email providers must implement this interface
 */
export interface EmailProviderAdapter {
  /**
   * Send an email
   */
  send(options: EmailOptions): Promise<EmailResult>;

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
