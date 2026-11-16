/**
 * Billing scheduler
 * @module Billing
 * @description Owns the billing @Cron jobs (they fire on the worker only; the API registers
 * ScheduleModule with `cronJobs: false`).
 *
 * Why a separate class: BillingService is also registered under the 'BILLING_SERVICE' alias
 * (`useExisting`, needed by moduleRef.get callers), and @nestjs/schedule's explorer does not skip
 * alias providers, so every @Cron on BillingService was registered TWICE on the worker. This
 * class has no alias, so each job is registered once. The job bodies and their lock handling
 * stay in BillingService; only the schedule lives here.
 */

import { Injectable } from '@nestjs/common';
import {
  SCHEDULED_TASK_DEFAULT_TZ,
  ScheduledTask,
} from '@core/decorators/scheduled-task.decorator';
import { BillingService } from '@services/billing/billing.service';

@Injectable()
export class BillingSchedulerService {
  constructor(private readonly billing: BillingService) {}

  /** Marks expired active subscriptions as PAST_DUE. */
  @ScheduledTask({
    id: 'billing.expire-subscriptions',
    group: 'billing',
    pattern: '0 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleExpiredSubscriptionsCron(): Promise<void> {
    await this.billing.checkExpiredSubscriptions();
  }

  /** Repairs payments stuck between the claim and their side effects. */
  @ScheduledTask({
    id: 'billing.repair-stalled-finalisations',
    group: 'billing',
    pattern: '*/10 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleStalledPaymentFinalisationsCron(): Promise<void> {
    await this.billing.repairStalledPaymentFinalisations();
  }

  /** Confirms bookings whose payment succeeded at the gateway but never reached us. */
  @ScheduledTask({
    id: 'billing.reconcile-stale-pending-payments',
    group: 'billing',
    pattern: '*/5 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleStalePendingPaymentsCron(): Promise<void> {
    await this.billing.reconcileStalePendingPayments();
  }

  /** Payment-window sweep: expires (or finalises) checkout attempts past their window. */
  @ScheduledTask({
    id: 'billing.expire-unpaid-checkouts',
    group: 'billing',
    pattern: '* * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleUnpaidCheckoutsCron(): Promise<void> {
    await this.billing.expireUnpaidCheckouts();
  }

  /** Reconciles legacy paid appointments still stuck in SCHEDULED. */
  @ScheduledTask({
    id: 'billing.reconcile-legacy-paid-appointments',
    group: 'billing',
    pattern: '0 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleLegacyPaidAppointmentsCron(): Promise<void> {
    await this.billing.reconcileLegacyPaidAppointments();
  }
}
