/**
 * Appointments scheduler
 * @module Appointments
 * @description Owns the appointment @Cron jobs (they fire on the worker only; the API registers
 * ScheduleModule with `cronJobs: false`).
 *
 * Why a separate class: AppointmentsService is also registered under the 'APPOINTMENTS_SERVICE'
 * alias (`useExisting`), and @nestjs/schedule's explorer, unlike @nestjs/event-emitter's, does not
 * skip alias providers. Every @Cron on AppointmentsService was therefore registered TWICE on the
 * single worker: each tick ran twice, the locked crons logged "lock held by another replica" on
 * every tick (the twin had just taken the lock) and the lock-less ones really ran twice. This
 * class has no alias, so each job is registered once.
 *
 * Every job is a @ClusterCron: with several worker replicas each tick runs on one of them.
 */

import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ClusterCron } from '@core/decorators/cluster-cron.decorator';
import { IST_TIMEZONE } from '@utils/date-time.util';
import { AppointmentsService } from './appointments.service';

@Injectable()
export class AppointmentsSchedulerService {
  constructor(private readonly appointments: AppointmentsService) {}

  @ClusterCron(CronExpression.EVERY_DAY_AT_3AM)
  async handleNoShowCancellationCron(): Promise<void> {
    await this.appointments.processNoShowCancellations();
  }

  @ClusterCron(CronExpression.EVERY_DAY_AT_7AM, { timeZone: IST_TIMEZONE })
  async handleDoctorDailyAppointmentSummaryCron(): Promise<void> {
    await this.appointments.triggerDoctorDailySummary({ triggeredBy: 'cron' });
  }

  @ClusterCron(CronExpression.EVERY_HOUR)
  async handleExpiredVideoSlotConfirmationCron(): Promise<void> {
    await this.appointments.processExpiredVideoSlotConfirmations();
  }

  /**
   * Closes every video visit that is still open when its window ends (see
   * AppointmentsService.processPastVideoCallClosures).
   */
  @ClusterCron(CronExpression.EVERY_5_MINUTES)
  async handlePastVideoCallClosureCron(): Promise<void> {
    await this.appointments.processPastVideoCallClosures();
  }

  /**
   * Expires in-clinic visits that never happened, hourly at :20 (see
   * AppointmentsService.processExpiredInPersonAppointments).
   */
  @ClusterCron('20 * * * *')
  async handleExpiredInPersonAppointmentsCron(): Promise<void> {
    await this.appointments.processExpiredInPersonAppointments();
  }
}
