/**
 * Partition Manager Service
 * ==========================
 * Service for managing database partitions dynamically
 * Creates partitions on-demand and maintains partition lifecycle
 *
 * @module PartitionManagerService
 * @description Automated partition management for 10M+ scale
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Partition Configuration
 */
interface PartitionConfig {
  tableName: string;
  partitionColumn: string;
  monthsAhead: number;
}

/**
 * Partition Manager Service
 * Manages database table partitions for scalability
 */
@Injectable()
export class PartitionManagerService implements OnModuleInit {
  private readonly logger = new Logger(PartitionManagerService.name);
  private readonly partitionConfigs: PartitionConfig[] = [
    { tableName: 'appointments', partitionColumn: 'date', monthsAhead: 12 },
    { tableName: 'check_ins', partitionColumn: 'checkedInAt', monthsAhead: 12 },
    { tableName: 'audit_logs', partitionColumn: 'timestamp', monthsAhead: 12 },
    { tableName: 'notifications', partitionColumn: 'createdAt', monthsAhead: 12 },
  ];

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async onModuleInit(): Promise<void> {
    // Create future partitions on startup
    await this.createFuturePartitions();
  }

  /**
   * Create partitions for future months
   */
  async createFuturePartitions(): Promise<void> {
    for (const config of this.partitionConfigs) {
      try {
        await this.createPartitionsForTable(
          config.tableName,
          config.partitionColumn,
          config.monthsAhead
        );
      } catch (error) {
        this.logger.error(
          `Failed to create partitions for ${config.tableName}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Create partitions for a specific table
   */
  private async createPartitionsForTable(
    tableName: string,
    partitionColumn: string,
    monthsAhead: number
  ): Promise<void> {
    const query = `SELECT create_future_partitions($1, $2, $3)`;
    await this.databaseService.executeRawQuery(query, [tableName, partitionColumn, monthsAhead]);

    this.logger.log(`Created partitions for ${tableName} (${monthsAhead} months ahead)`);
  }

  /**
   * Create a specific monthly partition
   */
  async createMonthlyPartition(
    tableName: string,
    partitionColumn: string,
    partitionDate: Date
  ): Promise<void> {
    const query = `SELECT create_monthly_partition($1, $2, $3)`;
    await this.databaseService.executeRawQuery(query, [
      tableName,
      partitionColumn,
      partitionDate.toISOString(),
    ]);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Created monthly partition for ${tableName}`,
      'PartitionManagerService',
      {
        tableName,
        partitionColumn,
        partitionDate: partitionDate.toISOString(),
      }
    );
  }

  /**
   * Get partition information
   */
  async getPartitionInfo(
    tableName: string
  ): Promise<Array<{ name: string; size: string; rowCount: number }>> {
    const query = `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
        (SELECT COUNT(*) FROM ${tableName}_partitioned WHERE tablename = $1) as row_count
      FROM pg_tables
      WHERE tablename LIKE $2
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;
    const result = await this.databaseService.executeRawQuery<
      Array<{ name: string; size: string; rowCount: number }>
    >(query, [`${tableName}_%`, `${tableName}_%`]);
    return result;
  }
}
