/**
 * Provider Health Status
 * Shared type for all provider adapters
 */
export interface ProviderHealthStatus {
  healthy: boolean;
  latency?: number;
  lastChecked: Date;
  error?: string;
}
