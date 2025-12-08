/**
 * Provider Adapter Interfaces
 * ============================
 * Base interfaces for all communication provider adapters
 * Follows Strategy pattern for provider-agnostic communication
 *
 * @module ProviderAdapters
 * @description Provider adapter interfaces
 */

export * from './provider-health-status.types';
export * from './email-provider.adapter';
export * from './whatsapp-provider.adapter';
export * from './sms-provider.adapter';
