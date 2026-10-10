import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import type { PhiAuditEntry } from '@core/types/compliance.types';
import { PHI_AUDIT_LOG_ACTION_PREFIX } from '@core/types/compliance.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';

const USER_AGENT_MAX_LENGTH = 256;

/**
 * Records who accessed which patient record.
 *
 * Two sinks, written independently so a failure of one never loses the other:
 *  - `LoggingService.logPhiAccess` (existing): the application log stream and its alerting.
 *  - A structured `AuditLog` row with `resourceType` / `resourceId` set. The general log sink
 *    leaves those empty, so without this row "who viewed visit X" cannot be answered. Rows are
 *    identified by the `PHI_` action prefix; a database trigger makes them append-only.
 *
 * `record` is for ordinary clinical reads: auditing must not break the request, so it never throws
 * and a failed write is logged at ERROR level. `recordStrict` is for exports of a whole record: it
 * throws when the structured row cannot be written, so the export does not happen unaudited.
 */
@Injectable()
export class PhiAuditService {
  private readonly serviceName = 'PhiAuditService';

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggingService
  ) {}

  async record(entry: PhiAuditEntry): Promise<void> {
    const outcome = entry.outcome ?? 'SUCCESS';
    const [logged, stored] = await Promise.allSettled([
      this.writeLogLine(entry, outcome),
      this.writeStructuredRow(entry, outcome),
    ]);
    if (logged.status === 'rejected') this.reportFailure('log sink', entry, logged.reason);
    if (stored.status === 'rejected') this.reportFailure('AuditLog row', entry, stored.reason);
  }

  /** Like `record`, but throws if the structured AuditLog row could not be written. */
  async recordStrict(entry: PhiAuditEntry): Promise<void> {
    const outcome = entry.outcome ?? 'SUCCESS';
    const [logged, stored] = await Promise.allSettled([
      this.writeLogLine(entry, outcome),
      this.writeStructuredRow(entry, outcome),
    ]);
    if (logged.status === 'rejected') this.reportFailure('log sink', entry, logged.reason);
    if (stored.status === 'rejected') {
      this.reportFailure('AuditLog row', entry, stored.reason);
      throw new HealthcareError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'The access could not be audited, so it was not performed',
        HttpStatus.INTERNAL_SERVER_ERROR,
        undefined,
        this.serviceName
      );
    }
  }

  private async writeLogLine(entry: PhiAuditEntry, outcome: string): Promise<void> {
    await this.logger.logPhiAccess(entry.userId, entry.userRole, entry.patientId, entry.action, {
      resource: entry.resourceType,
      resourceId: entry.resourceId,
      clinicId: entry.clinicId,
      ...(entry.ipAddress ? { ipAddress: entry.ipAddress } : {}),
      ...(entry.userAgent ? { userAgent: this.clipUserAgent(entry.userAgent) } : {}),
      ...(entry.fields ? { dataFields: [...entry.fields] } : {}),
      ...(entry.purpose ? { purpose: entry.purpose } : {}),
      ...(entry.reason ? { reason: entry.reason } : {}),
      outcome: outcome as 'SUCCESS' | 'FAILURE' | 'DENIED',
    });
  }

  private reportFailure(sink: string, entry: PhiAuditEntry, reason: unknown): void {
    void this.logger.log(
      LogType.ERROR,
      LogLevel.ERROR,
      `PHI audit write failed (${sink})`,
      this.serviceName,
      {
        clinicId: entry.clinicId,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        error: reason instanceof Error ? reason.message : String(reason),
      }
    );
  }

  private clipUserAgent(userAgent: string): string {
    return userAgent.length > USER_AGENT_MAX_LENGTH
      ? userAgent.slice(0, USER_AGENT_MAX_LENGTH)
      : userAgent;
  }

  private async writeStructuredRow(entry: PhiAuditEntry, outcome: string): Promise<void> {
    await this.database.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          auditLog: { create: (input: PrismaDelegateArgs) => Promise<unknown> };
        };
        await typedClient.auditLog.create({
          data: {
            userId: entry.userId,
            action: `${PHI_AUDIT_LOG_ACTION_PREFIX}${entry.action}`,
            description: `${entry.action} ${entry.resourceType} (${outcome})`,
            clinicId: entry.clinicId,
            resourceType: entry.resourceType,
            resourceId: entry.resourceId,
            ipAddress: entry.ipAddress ?? null,
            userAgent: entry.userAgent ? this.clipUserAgent(entry.userAgent) : null,
            metadata: {
              patientId: entry.patientId,
              userRole: entry.userRole,
              outcome,
              ...(entry.fields ? { fields: [...entry.fields] } : {}),
              ...(entry.purpose ? { purpose: entry.purpose } : {}),
              ...(entry.reason ? { reason: entry.reason } : {}),
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: entry.userId,
        userRole: entry.userRole,
        clinicId: entry.clinicId,
        operation: 'CREATE',
        resourceType: 'AUDIT_LOG',
        resourceId: entry.resourceId,
        // Audit rows are write-only compliance records, never served from cache.
        skipCacheInvalidation: true,
      }
    );
  }
}
