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
 */

import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClusterCron } from '@core/decorators/cluster-cron.decorator';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { IST_TIMEZONE } from '@utils/date-time.util';
import { AppointmentsService } from './appointments.service';

const PAST_VIDEO_CLOSURE_LOCK_KEY = 'lock:cron:appointments:past-video-closure';
/** Expires just before the next 5-minute tick, so a replica firing a moment later still skips. */
const PAST_VIDEO_CLOSURE_LOCK_TTL_SECONDS = 240;
const IN_PERSON_EXPIRY_LOCK_KEY = 'lock:cron:appointments:in-person-expiry';
const IN_PERSON_EXPIRY_LOCK_TTL_SECONDS = 3300;

@Injectable()
export class AppointmentsSchedulerService {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

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
   * AppointmentsService.processPastVideoCallClosures). One replica per tick: the lock is
   * deliberately not released and expires just before the next tick.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handlePastVideoCallClosureCron(): Promise<void> {
    const acquired = await this.acquireCronLock(
      PAST_VIDEO_CLOSURE_LOCK_KEY,
      PAST_VIDEO_CLOSURE_LOCK_TTL_SECONDS,
      'AppointmentsScheduler.handlePastVideoCallClosureCron'
    );
    if (!acquired) return;
    await this.appointments.processPastVideoCallClosures();
  }

  /**
   * Expires in-clinic visits that never happened, hourly at :20 (see
   * AppointmentsService.processExpiredInPersonAppointments).
   */
  @Cron('20 * * * *')
  async handleExpiredInPersonAppointmentsCron(): Promise<void> {
    const acquired = await this.acquireCronLock(
      IN_PERSON_EXPIRY_LOCK_KEY,
      IN_PERSON_EXPIRY_LOCK_TTL_SECONDS,
      'AppointmentsScheduler.handleExpiredInPersonAppointmentsCron'
    );
    if (!acquired) return;
    await this.appointments.processExpiredInPersonAppointments();
  }

  private async acquireCronLock(
    lockKey: string,
    ttlSeconds: number,
    source: string
  ): Promise<boolean> {
    const acquired = await this.cacheService.acquireLock(lockKey, ttlSeconds);
    if (!acquired) {
      // With one worker this should now never print; if it does, another worker replica is
      // running the same tick (or the cache is unreachable: acquireLock reports both as false).
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Cron run skipped: its lock is held by another replica, or the cache is unavailable',
        source,
        { lockKey, ttlSeconds }
      );
    }
    return acquired;
  }
}
