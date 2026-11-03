/**
 * In-person check-in needs the visit to be covered by the patient's active monthly plan. The
 * refusals carry the code NO_ACTIVE_PLAN so the check-in log records them as such (L1: they were
 * logged as OTHER) and the desk can tell "start / renew the plan" apart from a scan problem.
 */
import { BadRequestException } from '@nestjs/common';

export const NO_ACTIVE_PLAN_CODE = 'NO_ACTIVE_PLAN';

export const NO_ACTIVE_PLAN_MESSAGES = {
  missing: 'This in-person appointment needs an active plan before check-in',
  notFound: 'The active plan for this appointment could not be found',
  notValid: 'The active plan for this appointment is no longer valid',
  ended: 'The active plan coverage period has ended',
} as const;

export type NoActivePlanReason = keyof typeof NO_ACTIVE_PLAN_MESSAGES;

/** 400 `{ statusCode, code: 'NO_ACTIVE_PLAN', message }`. */
export class NoActivePlanError extends BadRequestException {
  readonly code = NO_ACTIVE_PLAN_CODE;

  constructor(readonly reason: NoActivePlanReason) {
    super({
      statusCode: 400,
      code: NO_ACTIVE_PLAN_CODE,
      message: NO_ACTIVE_PLAN_MESSAGES[reason],
    });
  }
}

export function isNoActivePlanError(error: unknown): boolean {
  if (error instanceof NoActivePlanError) return true;
  if (!(error instanceof BadRequestException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { code?: unknown }).code === NO_ACTIVE_PLAN_CODE
  );
}

/** Plan columns of the appointment check-in reads. */
export interface PlanCoverageColumns {
  subscriptionId?: string | null;
  isSubscriptionBased?: boolean | null;
}

/** True when the appointment carries no plan link at all (the safety net may link one). */
export function needsPlanLink(appointment: PlanCoverageColumns): boolean {
  return !appointment.subscriptionId || !appointment.isSubscriptionBased;
}

/** The patient's eligible in-person plan (subscription + holder) the booking path links. */
export interface InPersonPlanRef {
  subscriptionId: string;
  patientUserId: string;
}

/** The appointment columns the plan-less walk-in rule needs at check-in. */
export interface PlanlessVisitRef {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  date?: Date | string | null;
  metadata?: unknown;
}

/** Plan lookup + link of the booking service, handed to check-in (no import cycle). */
export interface InPersonPlanLinker {
  findActivePlan(patientId: string, clinicId: string): Promise<InPersonPlanRef | null>;
  linkPlan(plan: InPersonPlanRef, appointmentId: string, clinicId: string): Promise<void>;
  /**
   * The clinic's walk-in-without-plan rule (walk-in-plan-policy.util) for a visit with no plan:
   * true when the clinic lets it go ahead (free, or with a desk bill raised now), false when a
   * plan is required. Optional: without it every plan-less visit is refused (REQUIRE_PLAN).
   */
  allowWithoutPlan?(visit: PlanlessVisitRef): Promise<boolean>;
}
