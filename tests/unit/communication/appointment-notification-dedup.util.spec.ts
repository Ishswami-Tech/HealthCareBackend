import { describe, expect, it } from '@jest/globals';
import {
  APPOINTMENT_COMPLETED_PUSH,
  AppointmentNotificationDedup,
  CHECK_IN_KIND,
  appointmentCompletedChannels,
  appointmentNotificationKind,
} from '../../../src/libs/communication/listeners/appointment-notification-dedup.util';

const TTL = 30_000;
const FIRST_CONTACT = 120_000;
const plain = { appointmentId: 'appt-1', paymentId: '', fromCheckIn: false };
const checkIn = { appointmentId: 'appt-1', paymentId: '', fromCheckIn: true };

describe('appointmentNotificationKind', () => {
  it('folds both events of a check-in into one kind', () => {
    expect(appointmentNotificationKind('appointment.checked_in', checkIn)).toBe(CHECK_IN_KIND);
    expect(appointmentNotificationKind('appointment.confirmed', checkIn)).toBe(CHECK_IN_KIND);
  });

  it('keeps a payment confirmation and a plain confirmation as their own kind', () => {
    expect(
      appointmentNotificationKind('appointment.confirmed', { ...checkIn, paymentId: 'pay-1' })
    ).toBe('appointment.confirmed');
    expect(appointmentNotificationKind('appointment.confirmed', plain)).toBe(
      'appointment.confirmed'
    );
  });
});

describe('AppointmentNotificationDedup', () => {
  it('a check-in (checked_in + confirmed) notifies once', () => {
    const dedup = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(dedup.shouldSkip('appointment.checked_in', checkIn, 0)).toBe(false);
    expect(dedup.shouldSkip('appointment.confirmed', checkIn, 5)).toBe(true);
  });

  it('a walk-in (booked and checked in at once) notifies once, whatever the order', () => {
    const bookedFirst = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(bookedFirst.shouldSkip('appointment.created', plain, 0)).toBe(false);
    expect(bookedFirst.shouldSkip('appointment.checked_in', checkIn, 10)).toBe(true);
    expect(bookedFirst.shouldSkip('appointment.confirmed', checkIn, 20)).toBe(true);

    const arrivedFirst = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(arrivedFirst.shouldSkip('appointment.checked_in', checkIn, 0)).toBe(false);
    expect(arrivedFirst.shouldSkip('appointment.created', plain, 10)).toBe(true);
  });

  it('a later check-in of an appointment booked earlier still notifies', () => {
    const dedup = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(dedup.shouldSkip('appointment.created', plain, 0)).toBe(false);
    expect(dedup.shouldSkip('appointment.checked_in', checkIn, FIRST_CONTACT + 1)).toBe(false);
  });

  it('a payment confirmation right after booking still notifies', () => {
    const dedup = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(dedup.shouldSkip('appointment.created', plain, 0)).toBe(false);
    expect(dedup.shouldSkip('appointment.confirmed', { ...plain, paymentId: 'pay-1' }, 1_000)).toBe(
      false
    );
  });

  it('different appointments never suppress each other; non-appointment events pass', () => {
    const dedup = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(dedup.shouldSkip('appointment.created', plain, 0)).toBe(false);
    expect(dedup.shouldSkip('appointment.created', { ...plain, appointmentId: 'appt-2' }, 1)).toBe(
      false
    );
    expect(dedup.shouldSkip('user.updated', plain, 2)).toBe(false);
    expect(dedup.shouldSkip('user.updated', plain, 3)).toBe(false);
  });

  it('repeats of the same event are dropped only inside the TTL', () => {
    const dedup = new AppointmentNotificationDedup(TTL, FIRST_CONTACT);
    expect(dedup.shouldSkip('appointment.cancelled', plain, 0)).toBe(false);
    expect(dedup.shouldSkip('appointment.cancelled', plain, TTL - 1)).toBe(true);
    expect(dedup.shouldSkip('appointment.cancelled', plain, TTL * 2)).toBe(false);
  });
});

describe('visit completion push (doctor save & complete)', () => {
  it('no second push when the prescription-ready push covers the visit', () => {
    expect(appointmentCompletedChannels(true)).toEqual(['socket']);
  });

  it('a visit with no medicines gets one meaningful push', () => {
    expect(appointmentCompletedChannels(false)).toEqual(['push', 'socket']);
    expect(APPOINTMENT_COMPLETED_PUSH).toEqual({
      title: 'Visit completed',
      body: 'Your visit is complete. Open the app for your visit summary.',
    });
    expect(APPOINTMENT_COMPLETED_PUSH.title).not.toBe('Appointment Update');
  });
});
