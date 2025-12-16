/**
 * Database Health Indicator for Health Module
 * @class DatabaseHealthIndicator
 * @description Health indicator for database service using @nestjs/terminus
 */

import { Injectable, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
// Use direct import to avoid TDZ issues with barrel exports
// Import service directly and type from core types
import { DatabaseService } from '@infrastructure/database/database.service';
import type { DatabaseHealthStatus } from '@core/types';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    super();
  }

  async check(key: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.databaseService) {
        return this.getStatus(key, true, {
          message: 'Database service not available',
        });
      }

      const healthStatus: DatabaseHealthStatus = await this.databaseService.getHealthStatus();

      const result = this.getStatus(key, healthStatus.isHealthy, {
        isHealthy: healthStatus.isHealthy,
        connectionCount: healthStatus.connectionCount,
        activeQueries: healthStatus.activeQueries,
        avgResponseTime: healthStatus.avgResponseTime,
        lastHealthCheck: healthStatus.lastHealthCheck.toISOString(),
        errors: healthStatus.errors,
      });

      if (!healthStatus.isHealthy) {
        throw new HealthCheckError('Database service is unhealthy', result);
      }

      return result;
    } catch (error) {
      const result = this.getStatus(key, false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HealthCheckError('Database service health check failed', result);
    }
  }
}
