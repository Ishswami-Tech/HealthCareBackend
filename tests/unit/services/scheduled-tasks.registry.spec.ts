/// <reference types="jest" />
/**
 * Every recurring job is a @ScheduledTask (a BullMQ job scheduler on healthcare-queue). This pins
 * each one's id, pattern, time zone and attempts to what the old @Cron/@ClusterCron schedules
 * were, so the move to BullMQ changed WHERE jobs run, not WHEN.
 *
 * Jobs that had no time zone ran on the worker's process zone (TZ=Asia/Kolkata); they now say so.
 */

import 'reflect-metadata';

import {
  SCHEDULED_TASK_DEFAULT_TZ,
  SCHEDULED_TASK_METADATA,
  type ScheduledTaskOptions,
} from '@core/decorators/scheduled-task.decorator';
import { CacheWarmingService } from '@infrastructure/cache/services/cache-warming.service';
import { AppointmentsSchedulerService } from '@services/appointments/appointments-scheduler.service';
import { InPersonQueueMaintenanceService } from '@services/appointments/in-person/in-person-queue-maintenance.service';
import { VideoAppointmentSchedulerService } from '@services/appointments/plugins/video/video-scheduler.service';
import { BillingSchedulerService } from '@services/billing/billing-scheduler.service';

const IST = SCHEDULED_TASK_DEFAULT_TZ;

type Row = [method: string, id: string, pattern: string, tz: string, attempts: number];

const EXPECTED: Array<[name: string, prototype: object, rows: Row[]]> = [
  [
    'AppointmentsSchedulerService',
    AppointmentsSchedulerService.prototype,
    [
      ['handleNoShowCancellationCron', 'appointments.cancel-no-shows', '0 3 * * *', IST, 3],
      ['handleDoctorSummariesCron', 'appointments.doctor-summaries', '* * * * *', IST, 1],
      [
        'handleExpiredVideoSlotConfirmationCron',
        'appointments.expire-video-slot-confirmations',
        '0 * * * *',
        IST,
        1,
      ],
      [
        'handlePastVideoCallClosureCron',
        'appointments.close-past-video-calls',
        '*/5 * * * *',
        IST,
        1,
      ],
      [
        'handleExpiredInPersonAppointmentsCron',
        'appointments.expire-in-person',
        '20 * * * *',
        IST,
        1,
      ],
    ],
  ],
  [
    'InPersonQueueMaintenanceService',
    InPersonQueueMaintenanceService.prototype,
    [
      ['reconcileLiveQueuesCron', 'in-person-queue.reconcile-live-queues', '*/5 * * * *', IST, 1],
      ['cleanupTokenCountersCron', 'in-person-queue.cleanup-token-counters', '15 3 * * *', IST, 3],
      ['notifyQueuePositionsCron', 'in-person-queue.notify-queue-positions', '* * * * *', IST, 1],
    ],
  ],
  [
    'VideoAppointmentSchedulerService',
    VideoAppointmentSchedulerService.prototype,
    [
      ['handleDoctorNoShows', 'video.doctor-no-shows', '* * * * *', IST, 1],
      ['handlePatientNoShows', 'video.patient-no-shows', '* * * * *', IST, 1],
      [
        'handleExpiredConfirmedVideoAppointments',
        'video.expire-confirmed-appointments',
        '* * * * *',
        IST,
        1,
      ],
      ['handleOpenVideoVisitReminders', 'video.open-visit-reminders', '*/5 * * * *', IST, 1],
      ['handleExpiredPaymentWindows', 'video.expire-payment-windows', '* * * * *', IST, 1],
    ],
  ],
  [
    'BillingSchedulerService',
    BillingSchedulerService.prototype,
    [
      ['handleExpiredSubscriptionsCron', 'billing.expire-subscriptions', '0 * * * *', IST, 1],
      [
        'handleStalledPaymentFinalisationsCron',
        'billing.repair-stalled-finalisations',
        '*/10 * * * *',
        IST,
        1,
      ],
      [
        'handleStalePendingPaymentsCron',
        'billing.reconcile-stale-pending-payments',
        '*/5 * * * *',
        IST,
        1,
      ],
      ['handleUnpaidCheckoutsCron', 'billing.expire-unpaid-checkouts', '* * * * *', IST, 1],
      [
        'handleLegacyPaidAppointmentsCron',
        'billing.reconcile-legacy-paid-appointments',
        '0 * * * *',
        IST,
        1,
      ],
    ],
  ],
  [
    'CacheWarmingService',
    CacheWarmingService.prototype,
    [
      ['warmPopularCaches', 'cache.warm-popular', '0 */3 * * *', 'UTC', 3],
      ['warmDoctorSchedules', 'cache.warm-doctor-schedules', '0 2 * * *', 'UTC', 3],
    ],
  ],
];

function taskOf(prototype: object, method: string): ScheduledTaskOptions | undefined {
  const fn = (prototype as Record<string, unknown>)[method];
  return typeof fn === 'function'
    ? (Reflect.getMetadata(SCHEDULED_TASK_METADATA, fn) as ScheduledTaskOptions | undefined)
    : undefined;
}

describe('@ScheduledTask registry', () => {
  for (const [name, prototype, rows] of EXPECTED) {
    describe(name, () => {
      it.each(rows)('%s → %s %s (%s), attempts %i', (method, id, pattern, tz, attempts) => {
        expect(taskOf(prototype, method)).toEqual(
          expect.objectContaining({ id, pattern, tz, attempts })
        );
      });
    });
  }

  it('task ids are unique', () => {
    const ids = EXPECTED.flatMap(([, , rows]) => rows.map(row => row[1]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the empty proposal-expiry placeholder is not scheduled', () => {
    expect(
      taskOf(VideoAppointmentSchedulerService.prototype, 'handleExpiredProposals')
    ).toBeUndefined();
  });

  it('daily jobs retry, frequent sweeps leave it to the next tick', () => {
    for (const [, prototype, rows] of EXPECTED) {
      for (const [method] of rows) {
        const task = taskOf(prototype, method);
        const daily = /^\d+ \d+ \* \* \*$/.test(task?.pattern ?? '');
        expect({ method, attempts: task?.attempts }).toEqual({
          method,
          attempts: daily || task?.group === 'cache' ? 3 : 1,
        });
      }
    }
  });
});
