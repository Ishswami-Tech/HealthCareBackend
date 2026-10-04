import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { Role } from '@core/types/enums.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
// Direct import (not the barrel) to avoid TDZ issues, same as RbacGuard.
import { DatabaseService } from '@infrastructure/database/database.service';

interface SelfAccessRequest {
  user?: { id?: unknown; sub?: unknown; role?: unknown };
  params?: Record<string, unknown>;
}

/** Route params that identify a patient (User.id or Patient.id) on EHR routes. */
export const PATIENT_ID_ROUTE_PARAMS: readonly string[] = ['userId', 'patientId'];

export const PATIENT_ACCESS_DENIED_MESSAGE = 'Patients can only access their own health records';

/** Authenticated caller as far as patient-ownership checks are concerned. */
export interface PatientAccessActor {
  readonly userId: string;
  readonly role?: string | undefined;
}

type AccessClient = PrismaTransactionClientWithDelegates & {
  familyMember: {
    findMany: (args: PrismaDelegateArgs) => Promise<Array<{ userId: string | null }>>;
  };
};

export function isPatientRole(role: unknown): boolean {
  return typeof role === 'string' && role === String(Role.PATIENT);
}

/** The authenticated user's id (`id`, falling back to the JWT `sub`). */
export function resolveActorUserId(user: { id?: unknown; sub?: unknown }): string | undefined {
  const candidates = [user.id, user.sub];
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Pure helper: the set of identifiers a patient may address as "a patient":
 * their own User.id + Patient.id and the User.id + Patient.id of every ACTIVE
 * dependent linked to them. Both id spaces are included because EHR routes use
 * `:userId` (User.id) and `:patientId` (HealthRecord/Prescription use Patient.id)
 * interchangeably; they are UUIDs, so the two spaces cannot collide.
 */
export function buildPatientAccessScope(input: {
  readonly callerUserId: string;
  readonly callerPatientId?: string | null;
  readonly dependents: ReadonlyArray<{
    readonly userId?: string | null;
    readonly patientId?: string | null;
  }>;
}): ReadonlySet<string> {
  const ids = new Set<string>([input.callerUserId]);
  if (input.callerPatientId) {
    ids.add(input.callerPatientId);
  }
  for (const dependent of input.dependents) {
    if (dependent.userId) ids.add(dependent.userId);
    if (dependent.patientId) ids.add(dependent.patientId);
  }
  return ids;
}

/** Pure helper: may a patient whose scope is `scope` address `targetId`? */
export function isPatientTargetAllowed(scope: ReadonlySet<string>, targetId: string): boolean {
  return targetId.length > 0 && scope.has(targetId);
}

/**
 * Resolve the access scope of a PATIENT caller (self + active dependents).
 * Dependents are linked through `FamilyMember` (primary patient -> dependent
 * User); soft-deleted / inactive links grant nothing.
 */
export async function resolvePatientAccessScope(
  databaseService: DatabaseService,
  callerUserId: string
): Promise<ReadonlySet<string>> {
  return databaseService.executeHealthcareRead<ReadonlySet<string>>(async client => {
    const tc = client as unknown as AccessClient;

    const own = (await tc.patient.findFirst({
      where: { userId: callerUserId } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as { id: string } | null;
    if (!own) {
      return buildPatientAccessScope({ callerUserId, dependents: [] });
    }

    const links = await tc.familyMember.findMany({
      where: { patientId: own.id, isActive: true, deletedAt: null } as PrismaDelegateArgs,
      select: { userId: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    const dependentUserIds = links
      .map(link => link.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0);

    const dependentPatients =
      dependentUserIds.length > 0
        ? ((await tc.patient.findMany({
            where: { userId: { in: dependentUserIds } } as PrismaDelegateArgs,
            select: { id: true, userId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as Array<{ id: string; userId: string }>)
        : [];
    const patientIdByUserId = new Map(dependentPatients.map(row => [row.userId, row.id]));

    return buildPatientAccessScope({
      callerUserId,
      callerPatientId: own.id,
      dependents: dependentUserIds.map(userId => ({
        userId,
        patientId: patientIdByUserId.get(userId) ?? null,
      })),
    });
  });
}

/**
 * Service-level ownership assertion for `:id` style routes where the patient
 * is only known after the record is loaded. No-op for non-PATIENT callers
 * (staff are scoped by ClinicGuard / RBAC / clinic filters); throws 403 for a
 * PATIENT whose scope does not contain `targetPatientId`.
 */
export async function assertPatientMayAccess(
  databaseService: DatabaseService,
  actor: PatientAccessActor | undefined,
  targetPatientId: string
): Promise<void> {
  if (!actor || !isPatientRole(actor.role)) {
    return;
  }
  if (actor.userId === targetPatientId) {
    return;
  }
  const scope = await resolvePatientAccessScope(databaseService, actor.userId);
  if (!isPatientTargetAllowed(scope, targetPatientId)) {
    throw new ForbiddenException(PATIENT_ACCESS_DENIED_MESSAGE);
  }
}

/**
 * Patient self-access guard.
 *
 * `RbacGuard` grants access as soon as the caller's role holds the permission
 * (e.g. PATIENT has `lab-reports:read`); its `requireOwnership` option is only a
 * fallback for callers WITHOUT the permission. On routes shaped
 * `/resource/:userId` or `/resource/:patientId` that left a patient able to read
 * another patient's records by changing the id in the URL.
 *
 * This guard closes that gap: when the authenticated user is a PATIENT, every
 * `:userId` / `:patientId` route param present must be their own id (User.id or
 * Patient.id) or the id of an ACTIVE dependent they are the primary patient of.
 * Own-User.id requests are decided without touching the database. Staff roles
 * are unaffected (they are scoped by ClinicGuard / RBAC as before).
 *
 * `:id` routes (record ids) cannot be decided here; those are enforced in the
 * service after the record is loaded (see `assertPatientMayAccess`).
 *
 * It runs as a guard (not inside the handler) so it also applies when the
 * response would be served by the cache interceptor.
 */
@Injectable()
export class PatientSelfAccessGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SelfAccessRequest>();
    const user = request.user;
    if (!user || !isPatientRole(user.role)) {
      return true;
    }

    const targets = PATIENT_ID_ROUTE_PARAMS.map(key => request.params?.[key]).filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
    if (targets.length === 0) {
      return true;
    }

    const callerUserId = resolveActorUserId(user);
    if (!callerUserId) {
      throw new ForbiddenException(PATIENT_ACCESS_DENIED_MESSAGE);
    }
    // user.sub and user.id are the same principal; accept either as "self".
    const selfIds = new Set(
      [user.id, user.sub].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    );
    if (targets.every(target => selfIds.has(target))) {
      return true;
    }

    const scope = await resolvePatientAccessScope(this.databaseService, callerUserId);
    if (!targets.every(target => isPatientTargetAllowed(scope, target))) {
      throw new ForbiddenException(PATIENT_ACCESS_DENIED_MESSAGE);
    }
    return true;
  }
}
