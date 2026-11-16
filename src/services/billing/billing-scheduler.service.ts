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
import { CronExpression } from '@nestjs/schedule';
import { ClusterCron } from '@core/decorators/cluster-cron.decorator';
import { BillingService } from '@services/billing/billing.service';

@Injectable()
export class BillingSchedulerService {
  constructor(private readonly billing: BillingService) {}

  /** Marks expired active subscriptions as PAST_DUE. */
  @ClusterCron(CronExpression.EVERY_HOUR)
  async handleExpiredSubscriptionsCron(): Promise<void> {
    await this.billing.checkExpiredSubscriptions();
  }

  /** Repairs payments stuck between the claim and their side effects. */
  @ClusterCron(CronExpression.EVERY_10_MINUTES)
  async handleStalledPaymentFinalisationsCron(): Promise<void> {
    await this.billing.repairStalledPaymentFinalisations();
  }

  /** Confirms bookings whose payment succeeded at the gateway but never reached us. */
  @ClusterCron(CronExpression.EVERY_5_MINUTES)
  async handleStalePendingPaymentsCron(): Promise<void> {
    await this.billing.reconcileStalePendingPayments();
  }

  /** Payment-window sweep: expires (or finalises) checkout attempts past their window. */
  @ClusterCron(CronExpression.EVERY_MINUTE)
  async handleUnpaidCheckoutsCron(): Promise<void> {
    await this.billing.expireUnpaidCheckouts();
  }

  /** Reconciles legacy paid appointments still stuck in SCHEDULED. */
  @ClusterCron(CronExpression.EVERY_HOUR)
  async handleLegacyPaidAppointmentsCron(): Promise<void> {
    await this.billing.reconcileLegacyPaidAppointments();
  }
}
