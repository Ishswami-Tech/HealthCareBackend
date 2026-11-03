/**
 * OpsDbService - thin typed wrapper over DatabaseService for the clinic-ops tables.
 * @module ClinicOps
 */

import { HttpException, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { resolveReceptionistLocationOrThrow } from '@utils/staff-location.util';
import { opsClient, type OpsClient } from '../clinic-ops.types';

export interface OpsActor {
  userId: string;
  role: string;
}

export interface OpsAudit {
  actor: OpsActor;
  clinicId: string;
  resourceType: string;
  operation: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}

/**
 * Runs a database call so that a deliberate HTTP refusal thrown inside it (404 unknown patient,
 * 400 foreign location, 409 conflict ...) reaches the client as-is instead of being wrapped by the
 * database layer into a 500 DATABASE_QUERY_FAILED.
 */
async function keepHttpErrors<T>(
  run: (guarded: (client: OpsClient) => Promise<T>) => Promise<T>,
  operation: (client: OpsClient) => Promise<T>
): Promise<T> {
  let refusal: HttpException | undefined;
  try {
    return await run(async client => {
      try {
        return await operation(client);
      } catch (error) {
        if (error instanceof HttpException) refusal = error;
        throw error;
      }
    });
  } catch (error) {
    throw refusal ?? error;
  }
}

@Injectable()
export class OpsDbService {
  constructor(private readonly databaseService: DatabaseService) {}

  read<T>(operation: (client: OpsClient) => Promise<T>): Promise<T> {
    return keepHttpErrors(
      guarded =>
        this.databaseService.executeHealthcareRead<T>(client => guarded(opsClient(client))),
      operation
    );
  }

  write<T>(operation: (client: OpsClient) => Promise<T>, audit: OpsAudit): Promise<T> {
    return keepHttpErrors(
      guarded =>
        this.databaseService.executeHealthcareWrite<T>(client => guarded(opsClient(client)), {
          userId: audit.actor.userId || 'system',
          userRole: audit.actor.role || 'system',
          clinicId: audit.clinicId,
          resourceType: audit.resourceType,
          operation: audit.operation,
          ...(audit.resourceId ? { resourceId: audit.resourceId } : {}),
          ...(audit.details ? { details: audit.details } : {}),
          timestamp: new Date(),
        }),
      operation
    );
  }

  /**
   * The location filter a caller may use: a RECEPTIONIST is pinned to its allotted location (from
   * the staff assignment, 403 when it has none), everybody else keeps what they asked for.
   */
  async locationScope(
    actor: OpsActor,
    clinicId: string,
    requested?: string
  ): Promise<string | undefined> {
    if (actor.role.toUpperCase() !== 'RECEPTIONIST') return requested;
    return resolveReceptionistLocationOrThrow(this.databaseService, actor.userId, clinicId);
  }

  /** Several writes that must succeed or fail together. */
  transaction<T>(operation: (client: OpsClient) => Promise<T>): Promise<T> {
    return keepHttpErrors(
      guarded => this.databaseService.executeInTransaction<T>(client => guarded(opsClient(client))),
      operation
    );
  }
}
