/**
 * SQL Injection Prevention Service
 * @class SQLInjectionPreventionService
 * @description Detects and prevents SQL injection attacks
 *
 * @internal
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface SQLInjectionCheckResult {
  isSafe: boolean;
  detectedPatterns: string[];
  sanitized?: string;
}

/**
 * SQL injection prevention service
 * @internal
 */
@Injectable()
export class SQLInjectionPreventionService {
  private readonly serviceName = 'SQLInjectionPreventionService';

  // Common SQL injection patterns
  private readonly sqlInjectionPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
    /(--|#|\/\*|\*\/|;)/g,
    /(\bOR\b\s*\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s*\d+\s*=\s*\d+)/gi,
    /('|"|`).*(\bOR\b|\bAND\b).*('|"|`)/gi,
    /(\bUNION\b.*\bSELECT\b)/gi,
    /(\bEXEC\b|\bEXECUTE\b)/gi,
    /(\bxp_\w+\b)/gi, // SQL Server extended procedures
    /(\bLOAD_FILE\b|\bINTO\s+OUTFILE\b)/gi, // MySQL file operations
    /(\bpg_read_file\b)/gi, // PostgreSQL file operations
  ];

  private readonly enabled: boolean;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.enabled =
      this.configService.get<boolean>('database.sqlInjectionPrevention.enabled') ?? true;
  }

  /**
   * Check for SQL injection patterns
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  checkSQLInjection(input: string): SQLInjectionCheckResult {
    if (!this.enabled) {
      return { isSafe: true, detectedPatterns: [] };
    }

    const detectedPatterns: string[] = [];

    for (const pattern of this.sqlInjectionPatterns) {
      if (pattern.test(input)) {
        const matches = input.match(pattern);
        if (matches) {
          detectedPatterns.push(...matches);
        }
      }
    }

    const isSafe = detectedPatterns.length === 0;

    if (!isSafe) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `SQL injection pattern detected: ${detectedPatterns.join(', ')}`,
        this.serviceName,
        {
          input: input.substring(0, 200), // Truncate for logging
          detectedPatterns,
        }
      );
    }

    return {
      isSafe,
      detectedPatterns: [...new Set(detectedPatterns)], // Remove duplicates
    };
  }

  /**
   * Sanitize input to prevent SQL injection
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  sanitizeInput(input: string): string {
    // Remove or escape dangerous characters
    return input
      .replace(/['";\\]/g, '') // Remove quotes and semicolons
      .replace(/--/g, '') // Remove SQL comments
      .replace(/\/\*/g, '') // Remove block comment start
      .replace(/\*\//g, ''); // Remove block comment end
  }

  /**
   * Validate query parameters
   * INTERNAL: Only accessible by DatabaseService
   * @internal
   */
  validateParameters(parameters: unknown[]): boolean {
    for (const param of parameters) {
      if (typeof param === 'string') {
        const check = this.checkSQLInjection(param);
        if (!check.isSafe) {
          return false;
        }
      }
    }
    return true;
  }
}
