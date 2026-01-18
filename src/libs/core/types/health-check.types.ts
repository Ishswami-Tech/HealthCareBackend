/**
 * Health Check Provider Interface
 * 
 * SOLID Principles:
 * - Interface Segregation: Specific interface for health check operations
 * - Dependency Inversion: Depend on abstraction, not concrete implementation
 * 
 * KISS Principle: Simple interface with single responsibility
 * DRY Principle: Reusable interface across multiple health check providers
 * 
 * Purpose: Break circular dependency between video.module and health.module
 * Location: @core/types per .ai-rules - all types must be in @core/types
 */

export interface HealthStatus {
  healthy: boolean;
  status: 'up' | 'down' | 'degraded';
  timestamp: Date;
  details?: Record<string, unknown>;
}

export interface IHealthCheckProvider {
  checkHealth(): Promise<HealthStatus>;
}
