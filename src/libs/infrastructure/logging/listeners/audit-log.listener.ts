import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseService } from '@infrastructure/database/database.service';
import type { EnterpriseEventPayload } from '@core/types';

/**
 * Audit Log Event Listener
 *
 * Listens to 'logging.audit.requested' events and persists them to database.
 * This breaks the circular dependency between LoggingService and DatabaseService.
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles audit log persistence
 * - Dependency Inversion: Depends on EventService abstraction via @OnEvent decorator
 *
 * Architecture:
 * - LoggingService emits 'logging.audit.requested' events via EventService
 * - This listener receives events and writes to database
 * - No direct dependency between LoggingService and DatabaseService
 */
@Injectable()
export class AuditLogListener {
  constructor(private readonly databaseService: DatabaseService) {}

  @OnEvent('logging.audit.requested')
  async handleAuditLogRequest(event: EnterpriseEventPayload): Promise<void> {
    try {
      const { metadata, userId, clinicId } = event;

      // Type-safe metadata extraction using bracket notation
      const actionValue = metadata?.['action'];
      const action = typeof actionValue === 'string' ? actionValue : 'UNKNOWN';
      
      const descriptionValue = metadata?.['description'];
      const description = typeof descriptionValue === 'string' ? descriptionValue : 'No description';
      
      const ipAddressValue = metadata?.['ipAddress'];
      const ipAddress = typeof ipAddressValue === 'string' ? ipAddressValue : null;
      
      const deviceValue = metadata?.['device'];
      const device = typeof deviceValue === 'string' ? deviceValue : null;

      // Use executeHealthcareWrite - the client parameter is typed internally by DatabaseService
      const result = await this.databaseService.executeHealthcareWrite(
        async client => {
          // The client is a PrismaTransactionClient which has auditLog delegate
          // We access it directly - Prisma's types handle this internally
          const auditLogResult = await (
            client as {
              auditLog: {
                create: (args: {
                  data: {
                    userId: string;
                    action: string;
                    description: string;
                    ipAddress: string | null;
                    device: string | null;
                    clinicId: string | null;
                  };
                }) => Promise<{ id: string }>;
              };
            }
          ).auditLog.create({
            data: {
              userId: userId || 'system',
              action,
              description,
              ipAddress,
              device,
              clinicId: clinicId || null,
            },
          });
          return auditLogResult;
        },
        {
          userId: userId || 'system',
          userRole: 'system',
          clinicId: clinicId || '',
          operation: `LOG_${action}`,
          resourceType: 'AUDIT_LOG',
          resourceId: 'pending',
          timestamp: new Date(event.timestamp),
        }
      );

      // Explicitly use the result to avoid unused variable warning
      void result;
    } catch (error) {
      // Silent fail - audit logging shouldn't break the app
      // Error is already logged by DatabaseService
      console.error('[AuditLogListener] Failed to persist audit log:', error);
    }
  }
}
