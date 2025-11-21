/**
 * SQL Injection Prevention Service
 * @class SQLInjectionPreventionService
 * @description Additional validation layer to detect and block malicious queries
 * Validates all query parameters and whitelists allowed query patterns
 *
 * INTERNAL INFRASTRUCTURE COMPONENT - NOT FOR DIRECT USE
 * All methods are private/protected. Use HealthcareDatabaseClient instead.
 * @internal
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/**
 * SQL Injection Prevention Service
 * Validates queries and parameters for SQL injection patterns
 */
@Injectable()
export class SQLInjectionPreventionService implements OnModuleInit {
  private readonly serviceName = 'SQLInjectionPreventionService';
  private preventionEnabled = true;

  // Suspicious SQL patterns (case-insensitive)
  private readonly suspiciousPatterns = [
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bSELECT\b.*\bFROM\b.*\bWHERE\b.*['"]\s*=\s*['"])/i,
    /(\bDROP\s+(TABLE|DATABASE|INDEX|VIEW)\b)/i,
    /(\bDELETE\s+FROM\b)/i,
    /(\bEXEC\s*\(|\bEXECUTE\s*\()/i,
    /(\bINSERT\s+INTO\b.*\bVALUES\b)/i,
    /(\bUPDATE\b.*\bSET\b.*['"]\s*=\s*['"])/i,
    /(--|\/\*|\*\/)/, // SQL comments
    /(;\s*--|;\s*\/\*)/, // Comment injection
    /(\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i, // OR 1=1 pattern
    /(\bAND\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i, // AND 1=1 pattern
    /(\bBENCHMARK\s*\()/i,
    /(\bSLEEP\s*\()/i,
    /(\bWAITFOR\s+DELAY)/i,
    /(\bXP_CMDSHELL\b)/i,
    /(\bSP_EXECUTESQL\b)/i,
  ];

  // Allowed query patterns (whitelist)
  private readonly allowedPatterns = [
    /^\s*SELECT\s+/i, // SELECT queries
    /^\s*INSERT\s+INTO/i, // INSERT queries (via Prisma)
    /^\s*UPDATE\s+/i, // UPDATE queries (via Prisma)
    /^\s*DELETE\s+FROM/i, // DELETE queries (via Prisma)
    /^\s*WITH\s+/i, // CTE queries
    /^\s*EXPLAIN\s+/i, // EXPLAIN queries
  ];

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    this.preventionEnabled =
      this.configService.get<boolean>('SQL_INJECTION_PREVENTION_ENABLED') ?? true;
  }

  onModuleInit(): void {
    if (this.preventionEnabled) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        'SQL injection prevention service initialized',
        this.serviceName
      );
    } else {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'SQL injection prevention is disabled',
        this.serviceName
      );
    }
  }

  /**
   * Validate query for SQL injection patterns
   * @param query - SQL query string
   * @param params - Query parameters
   * @throws HealthcareError if SQL injection detected
   * @internal
   */
  validateQuery(query: string, params: Array<string | number | boolean | null> = []): void {
    if (!this.preventionEnabled) {
      return;
    }

    // Check for suspicious patterns
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(query)) {
        this.logAndThrowSecurityViolation(
          'SQL injection attempt detected',
          query,
          params,
          `Pattern matched: ${pattern.toString()}`
        );
      }
    }

    // Validate parameters for suspicious content
    for (const param of params) {
      if (typeof param === 'string') {
        this.validateParameter(param);
      }
    }

    // Check if query matches allowed patterns (for raw queries)
    // Note: Prisma queries are already safe, but we validate raw queries
    if (query.trim().startsWith('$')) {
      // Prisma query - skip validation
      return;
    }

    const isAllowed = this.allowedPatterns.some(pattern => pattern.test(query));
    if (!isAllowed && query.trim().length > 0) {
      this.logAndThrowSecurityViolation(
        'Query does not match allowed patterns',
        query,
        params,
        'Query must start with SELECT, INSERT, UPDATE, DELETE, WITH, or EXPLAIN'
      );
    }
  }

  /**
   * Validate parameter for suspicious content
   */
  private validateParameter(param: string): void {
    // Check for SQL comment patterns in parameters
    if (param.includes('--') || param.includes('/*') || param.includes('*/')) {
      this.logAndThrowSecurityViolation(
        'SQL comment pattern detected in parameter',
        '',
        [param],
        'Parameters cannot contain SQL comments'
      );
    }

    // Check for SQL keywords in parameters (potential injection)
    const sqlKeywords = ['UNION', 'SELECT', 'DROP', 'DELETE', 'EXEC', 'INSERT', 'UPDATE'];
    const upperParam = param.toUpperCase();
    for (const keyword of sqlKeywords) {
      if (upperParam.includes(keyword) && param.length > keyword.length + 5) {
        // Allow if it's part of a normal word (e.g., "SELECTION" contains "SELECT")
        // But flag if it's isolated or suspicious
        const keywordPattern = new RegExp(`\\b${keyword}\\b`, 'i');
        if (keywordPattern.test(param)) {
          this.logAndThrowSecurityViolation(
            `SQL keyword "${keyword}" detected in parameter`,
            '',
            [param],
            'Parameters cannot contain isolated SQL keywords'
          );
        }
      }
    }
  }

  /**
   * Log security violation and throw error
   */
  private logAndThrowSecurityViolation(
    message: string,
    query: string,
    params: Array<string | number | boolean | null>,
    details: string
  ): void {
    const sanitizedQuery = query.substring(0, 200); // Limit query length in logs
    const sanitizedParams = params.map(p => {
      if (typeof p === 'string') {
        return p.substring(0, 100); // Limit param length
      }
      return p;
    });

    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.ERROR,
      `SQL injection attempt detected: ${message}`,
      this.serviceName,
      {
        query: sanitizedQuery,
        params: sanitizedParams,
        details,
        timestamp: new Date().toISOString(),
      }
    );

    throw new HealthcareError(
      ErrorCode.SECURITY_VIOLATION,
      'Potential SQL injection detected. Query rejected for security.',
      undefined,
      {
        message,
        details,
      },
      this.serviceName
    );
  }

  /**
   * Check if prevention is enabled
   */
  isPreventionEnabled(): boolean {
    return this.preventionEnabled;
  }
}
