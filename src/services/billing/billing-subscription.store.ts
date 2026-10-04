/**
 * Atomic subscription primitives: optimistic period updates (so one payment can never buy two
 * intervals) and quota reservation / release that cannot be overspent or double-restored.
 */

import type { DatabaseService } from '@infrastructure/database';
import type { JsonRecord } from '@services/billing/billing-payment-finalisation.util';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@core/types/enums.types';

export interface PlanRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  clinicId: string | null;
  isUnlimitedAppointments: boolean;
  appointmentsIncluded: number | null;
}

export interface SubscriptionRow {
  id: string;
  userId: string;
  clinicId: string;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  appointmentsUsed: number;
  appointmentsRemaining: number | null;
  metadata: unknown;
  plan: PlanRow | null;
}

type WhereInput = Record<string, unknown>;
type UpdateManyResult = { count: number };

interface SubscriptionDelegate {
  findUnique: (args: {
    where: { id: string };
    include: { plan: true };
  }) => Promise<SubscriptionRow | null>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

interface AppointmentLinkDelegate {
  findUnique: (args: {
    where: { id: string };
    select: { subscriptionId: true; clinicId: true };
  }) => Promise<{ subscriptionId: string | null; clinicId: string } | null>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

type SubscriptionClient = {
  subscription: SubscriptionDelegate;
  appointment: AppointmentLinkDelegate;
};

export type BookAppointmentOutcome =
  'booked' | 'already-linked' | 'linked-elsewhere' | 'quota-exhausted';

export type ReleaseAppointmentOutcome = 'released' | 'not-linked';

export class BillingSubscriptionStore {
  constructor(private readonly database: DatabaseService) {}

  /** Fresh primary-database read of a subscription with its plan. */
  async readSubscription(
    subscriptionId: string,
    clinicId: string
  ): Promise<SubscriptionRow | null> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as SubscriptionClient).subscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        }),
      {
        userId: 'system',
        userRole: 'system',
        clinicId,
        resourceType: 'SUBSCRIPTION',
        resourceId: subscriptionId,
        operation: 'READ_FRESH',
        skipCacheInvalidation: true,
      }
    );
  }

  /**
   * Optimistic update: matches only while status and period are still the ones the caller read,
   * so two concurrent renewals cannot both extend the same period.
   */
  async updateIfUnchanged(observed: SubscriptionRow, data: JsonRecord): Promise<boolean> {
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as SubscriptionClient).subscription.updateMany({
          where: {
            id: observed.id,
            status: observed.status,
            currentPeriodStart: observed.currentPeriodStart,
            currentPeriodEnd: observed.currentPeriodEnd,
          },
          data,
        }),
      {
        userId: 'system',
        userRole: 'system',
        clinicId: observed.clinicId,
        resourceType: 'SUBSCRIPTION',
        resourceId: observed.id,
        operation: 'UPDATE',
        details: { reason: 'Subscription renewed after payment' },
      }
    );
    return result.count === 1;
  }

  /**
   * Links an appointment to a subscription and reserves one quota slot, in one transaction.
   * The link is a compare-and-set on `subscriptionId IS NULL`; the quota change is a conditional
   * `appointmentsRemaining > 0` decrement, so concurrent calls can never overspend the plan.
   */
  async bookAppointment(args: {
    subscription: SubscriptionRow;
    appointmentId: string;
  }): Promise<BookAppointmentOutcome> {
    const { subscription, appointmentId } = args;
    const tracksQuota = !subscription.plan?.isUnlimitedAppointments;
    return this.database.executeInTransaction(async client => {
      const tx = client as unknown as SubscriptionClient;
      const linked = await tx.appointment.updateMany({
        where: { id: appointmentId, clinicId: subscription.clinicId, subscriptionId: null },
        data: { subscriptionId: subscription.id, isSubscriptionBased: true },
      });
      if (linked.count !== 1) {
        const current = await tx.appointment.findUnique({
          where: { id: appointmentId },
          select: { subscriptionId: true, clinicId: true },
        });
        return current?.subscriptionId === subscription.id ? 'already-linked' : 'linked-elsewhere';
      }

      if (tracksQuota) {
        const reserved = await tx.subscription.updateMany(
          subscription.appointmentsRemaining !== null
            ? {
                where: { id: subscription.id, appointmentsRemaining: { gt: 0 } },
                data: {
                  appointmentsUsed: { increment: 1 },
                  appointmentsRemaining: { decrement: 1 },
                },
              }
            : {
                where: { id: subscription.id },
                data: { appointmentsUsed: { increment: 1 } },
              }
        );
        if (reserved.count !== 1) {
          await tx.appointment.updateMany({
            where: { id: appointmentId, subscriptionId: subscription.id },
            data: { subscriptionId: null, isSubscriptionBased: false },
          });
          return 'quota-exhausted';
        }
      }
      return 'booked';
    });
  }

  /**
   * Unlinks an appointment and restores its quota slot - only when this call actually matched the
   * link, so repeated cancellations restore nothing, and never above the plan limit.
   */
  async releaseAppointment(args: {
    subscription: SubscriptionRow;
    appointmentId: string;
  }): Promise<ReleaseAppointmentOutcome> {
    const { subscription, appointmentId } = args;
    const tracksQuota = !subscription.plan?.isUnlimitedAppointments;
    const included = subscription.plan?.appointmentsIncluded ?? null;
    return this.database.executeInTransaction(async client => {
      const tx = client as unknown as SubscriptionClient;
      const unlinked = await tx.appointment.updateMany({
        where: { id: appointmentId, subscriptionId: subscription.id },
        data: { subscriptionId: null, isSubscriptionBased: false },
      });
      if (unlinked.count !== 1) {
        return 'not-linked';
      }

      if (tracksQuota) {
        await tx.subscription.updateMany(
          subscription.appointmentsRemaining !== null && included !== null
            ? {
                where: {
                  id: subscription.id,
                  appointmentsUsed: { gt: 0 },
                  appointmentsRemaining: { lt: included },
                },
                data: {
                  appointmentsUsed: { decrement: 1 },
                  appointmentsRemaining: { increment: 1 },
                },
              }
            : {
                where: { id: subscription.id, appointmentsUsed: { gt: 0 } },
                data: { appointmentsUsed: { decrement: 1 } },
              }
        );
      }
      return 'released';
    });
  }
}

/**
 * Clinic / ownership rules for billing plans. A plan with a clinic belongs to that clinic;
 * a plan without one is platform-wide. Cross-clinic access answers 404, never 403, so plan ids
 * of other clinics cannot be probed.
 */

export interface PlanLike {
  clinicId?: string | null;
}

export interface PlanRequester {
  userId?: string;
  role?: string;
  clinicId?: string;
}

const PLAN_NOT_FOUND = 'Billing plan not found';

/** Readable by SUPER_ADMIN, by the owning clinic, and (when platform-wide) by everyone. */
export function assertPlanReadable(plan: PlanLike, requester?: PlanRequester): void {
  if (!requester || requester.role === 'SUPER_ADMIN') {
    return;
  }
  if (!plan.clinicId) {
    return;
  }
  if (requester.clinicId && plan.clinicId === requester.clinicId) {
    return;
  }
  throw new NotFoundException(PLAN_NOT_FOUND);
}

/** Editable / deletable by SUPER_ADMIN, or by the CLINIC_ADMIN of the plan's own clinic. */
export function assertPlanWritable(plan: PlanLike, requester?: PlanRequester): void {
  if (!requester || requester.role === 'SUPER_ADMIN') {
    return;
  }
  if (requester.role !== 'CLINIC_ADMIN') {
    throw new ForbiddenException('Only a clinic administrator can change billing plans');
  }
  if (!plan.clinicId) {
    throw new ForbiddenException('Only a platform administrator can change a platform-wide plan');
  }
  if (!requester.clinicId || plan.clinicId !== requester.clinicId) {
    throw new NotFoundException(PLAN_NOT_FOUND);
  }
}

/** A subscription may only use a plan of its own clinic or a platform-wide plan. */
export function assertPlanMatchesClinic(plan: PlanLike, clinicId: string): void {
  if (plan.clinicId && plan.clinicId !== clinicId) {
    throw new NotFoundException(PLAN_NOT_FOUND);
  }
}

/** Non-super-admins can only create plans for the clinic the guard validated. */
export function resolvePlanClinicId(
  requestedClinicId: string | undefined,
  requester?: PlanRequester
): string | undefined {
  if (!requester || requester.role === 'SUPER_ADMIN') {
    return requestedClinicId;
  }
  return requester.clinicId ?? requestedClinicId;
}

/**
 * Pure computation of what a payment does to a subscription (activation of an unpaid / lapsed
 * plan, or extension of an active one). No I/O: the caller applies the result with an optimistic
 * compare-and-set and stamps the payment id, so one payment can never buy two intervals.
 */

export function calculatePeriodEnd(start: Date, interval: string, intervalCount: number): Date {
  const end = new Date(start);

  switch (interval) {
    case 'DAILY':
      end.setDate(end.getDate() + intervalCount);
      break;
    case 'WEEKLY':
      end.setDate(end.getDate() + intervalCount * 7);
      break;
    case 'MONTHLY':
      end.setMonth(end.getMonth() + intervalCount);
      break;
    case 'QUARTERLY':
      end.setMonth(end.getMonth() + intervalCount * 3);
      break;
    case 'YEARLY':
      end.setFullYear(end.getFullYear() + intervalCount);
      break;
  }

  return end;
}

export type SubscriptionRenewalPlan =
  | { kind: 'noop' }
  | {
      kind: 'activation' | 'renewal';
      data: Record<string, unknown>;
      periodStart: Date;
      periodEnd: Date;
    };

const ACTIVATION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatus.INCOMPLETE,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
  SubscriptionStatus.PAST_DUE,
]);

const FIRST_ACTIVATION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatus.INCOMPLETE,
  SubscriptionStatus.INCOMPLETE_EXPIRED,
]);

/**
 * `activationOnly` is used when re-driving a payment of unknown history (completed before the
 * claim protocol existed): it activates a plan that is still INCOMPLETE / INCOMPLETE_EXPIRED /
 * PAST_DUE but never extends one that is already active.
 */
export function planSubscriptionRenewal(
  subscription: SubscriptionRow,
  options: { activationOnly?: boolean },
  now: Date
): SubscriptionRenewalPlan {
  const plan = subscription.plan;
  if (!plan) {
    return { kind: 'noop' };
  }

  const needsActivation = ACTIVATION_STATUSES.has(subscription.status);
  if (options.activationOnly && !needsActivation) {
    return { kind: 'noop' };
  }

  const appointmentsRemaining = plan.isUnlimitedAppointments
    ? null
    : plan.appointmentsIncluded || null;
  const quotaReset = {
    appointmentsUsed: 0,
    ...(appointmentsRemaining !== null && { appointmentsRemaining }),
  };
  // A payment that arrives after the period has already ended (expired plan, or an unpaid plan
  // paid late) starts a fresh period now; otherwise the plan would be paid for and still expired.
  const periodLapsed = new Date(subscription.currentPeriodEnd).getTime() <= now.getTime();

  if (needsActivation) {
    // First activation of an unpaid plan starts the paid period when the money arrives, not when
    // the checkout was opened - unless the plan was deliberately booked for a future start date,
    // which is kept. A lapsed PAST_DUE plan likewise restarts from the payment.
    const isFirstActivation = FIRST_ACTIVATION_STATUSES.has(subscription.status);
    const startsInFuture = new Date(subscription.currentPeriodStart).getTime() > now.getTime();
    const restartPeriod = isFirstActivation ? !startsInFuture : periodLapsed;

    const periodStart = restartPeriod ? now : new Date(subscription.currentPeriodStart);
    const periodEnd = restartPeriod
      ? calculatePeriodEnd(now, plan.interval, plan.intervalCount)
      : new Date(subscription.currentPeriodEnd);

    return {
      kind: 'activation',
      periodStart,
      periodEnd,
      data: {
        status: SubscriptionStatus.ACTIVE,
        ...quotaReset,
        ...(restartPeriod && { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }),
      },
    };
  }

  const periodStart = periodLapsed ? now : new Date(subscription.currentPeriodEnd);
  const periodEnd = calculatePeriodEnd(periodStart, plan.interval, plan.intervalCount);
  return {
    kind: 'renewal',
    periodStart,
    periodEnd,
    data: {
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      status: SubscriptionStatus.ACTIVE,
      ...quotaReset,
    },
  };
}
