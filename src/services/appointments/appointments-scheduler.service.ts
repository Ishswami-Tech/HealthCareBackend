/**
 * Appointments scheduler
 * @module Appointments
 * @description Owns the appointment scheduled jobs (they run on the worker only, as BullMQ job
 * schedulers on healthcare-queue).
 *
 * Why a separate class: AppointmentsService is also registered under the 'APPOINTMENTS_SERVICE'
 * alias (`useExisting`). @nestjs/schedule registered every @Cron on an alias twice, so each tick
 * ran twice; keeping the jobs on a class without an alias avoids that kind of trap (the
 * @ScheduledTask discovery also skips alias wrappers).
 *
 * Every job is a @ScheduledTask: a BullMQ job scheduler on healthcare-queue, one run per tick.
 */

import { Injectable } from '@nestjs/common';
import {
  SCHEDULED_TASK_DEFAULT_TZ,
  ScheduledTask,
} from '@core/decorators/scheduled-task.decorator';
import { AppointmentsService } from './appointments.service';

@Injectable()
export class AppointmentsSchedulerService {
  constructor(private readonly appointments: AppointmentsService) {}

  @ScheduledTask({
    id: 'appointments.cancel-no-shows',
    group: 'appointments',
    pattern: '0 3 * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 3,
  })
  async handleNoShowCancellationCron(): Promise<void> {
    await this.appointments.processNoShowCancellations();
  }

  /**
   * Doctor WhatsApp summaries: the morning full-day summary and one before each consultation
   * window. Their times are clinic settings (appointmentSettings.doctorSummary), so this checks
   * every minute what is due instead of firing at a fixed hour (two cheap reads per check).
   */
  @ScheduledTask({
    id: 'appointments.doctor-summaries',
    group: 'appointments',
    pattern: '* * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleDoctorSummariesCron(): Promise<void> {
    await this.appointments.triggerScheduledDoctorSummaries();
  }

  @ScheduledTask({
    id: 'appointments.expire-video-slot-confirmations',
    group: 'appointments',
    pattern: '0 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleExpiredVideoSlotConfirmationCron(): Promise<void> {
    await this.appointments.processExpiredVideoSlotConfirmations();
  }

  /**
   * Closes every video visit that is still open when its window ends (see
   * AppointmentsService.processPastVideoCallClosures).
   */
  @ScheduledTask({
    id: 'appointments.close-past-video-calls',
    group: 'appointments',
    pattern: '*/5 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handlePastVideoCallClosureCron(): Promise<void> {
    await this.appointments.processPastVideoCallClosures();
  }

  /**
   * Expires in-clinic visits that never happened, hourly at :20 (see
   * AppointmentsService.processExpiredInPersonAppointments).
   */
  @ScheduledTask({
    id: 'appointments.expire-in-person',
    group: 'appointments',
    pattern: '20 * * * *',
    tz: SCHEDULED_TASK_DEFAULT_TZ,
    attempts: 1,
  })
  async handleExpiredInPersonAppointmentsCron(): Promise<void> {
    await this.appointments.processExpiredInPersonAppointments();
  }
}
