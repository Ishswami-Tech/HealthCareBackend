/**
 * WhatsApp Provider Adapter Interface
 * ====================================
 * Base interface for all WhatsApp provider adapters
 * Follows Strategy pattern for provider-agnostic WhatsApp delivery
 *
 * @module WhatsAppProviderAdapter
 * @description WhatsApp provider adapter interface
 */

/**
 * WhatsApp Message Options
 */
export interface WhatsAppOptions {
  to: string; // Phone number with country code
  from?: string; // Sender number (optional, uses default)
  message: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  templateId?: string;
  templateParams?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

/**
 * WhatsApp Result
 */
export interface WhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
  timestamp: Date;
}

import type { ProviderHealthStatus } from './provider-health-status.types';

export type { ProviderHealthStatus };

/**
 * WhatsApp Provider Adapter Interface
 * All WhatsApp providers must implement this interface
 */
export interface WhatsAppProviderAdapter {
  /**
   * Send a WhatsApp message
   */
  send(options: WhatsAppOptions): Promise<WhatsAppResult>;

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
