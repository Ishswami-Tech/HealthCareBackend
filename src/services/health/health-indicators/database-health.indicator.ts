/**
 * Database Health Indicator for Health Module
 * @class DatabaseHealthIndicator
 * @description Health indicator for database service (no Terminus dependency)
 * Uses only LoggingService (per .ai-rules/ coding standards)
 * Follows SOLID, DRY, and KISS principles
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicatorResult } from './types';
// Use direct import to avoid TDZ issues with barrel exports
// Import service directly and type from core types
import { DatabaseService } from '@infrastructure/database/database.service';
import type { DatabaseHealthStatus } from '@core/types';
import { BaseHealthIndicator } from './base-health.indicator';

@Injectable()
export class DatabaseHealthIndicator extends BaseHealthIndicator<DatabaseHealthStatus> {
  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    super();
  }

  protected isServiceAvailable(): boolean {
    return this.databaseService !== undefined && this.databaseService !== null;
  }

  protected getServiceName(): string {
    return 'Database';
  }

  protected async getHealthStatus(): Promise<DatabaseHealthStatus> {
    if (!this.databaseService) {
      throw new Error('Database service not available');
    }
    return await this.databaseService.getHealthStatus();
  }

  protected formatResult(key: string, status: DatabaseHealthStatus): HealthIndicatorResult {
    return this.getStatus(key, status.isHealthy, {
      isHealthy: status.isHealthy,
      connectionCount: status.connectionCount,
      activeQueries: status.activeQueries,
      avgResponseTime: status.avgResponseTime,
      lastHealthCheck: status.lastHealthCheck.toISOString(),
      errors: status.errors,
    });
  }

  protected extractIsHealthy(status: DatabaseHealthStatus): boolean {
    return status.isHealthy;
  }
}
