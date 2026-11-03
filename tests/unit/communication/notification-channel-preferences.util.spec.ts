import { describe, expect, it } from '@jest/globals';
import {
  CommunicationCategory,
  CommunicationPriority,
} from '../../../src/libs/core/types/communication.types';
import {
  QUIET_HOURS_DEFAULT_TIMEZONE,
  defaultPreferenceFlags,
  filterChannelsByPreferences,
  isWithinQuietHours,
  normalizePreferenceFlags,
  notificationPreferenceView,
  toUserCommunicationPreferences,
  wallClockMinutes,
  type NotificationPreferenceRow,
  type PreferenceSource,
} from '../../../src/libs/communication/services/notification-channel-preferences.util';
import { initialNotificationState } from '../../../src/libs/communication/services/notification-delivery-plan.util';

const USER = 'u-rel-201';
/** 13:58 IST on 1 Nov 2026 (the "You're next" of the release E2E). */
const AFTERNOON_IST = new Date('2026-11-01T08:28:00.000Z');
/** 23:30 IST. */
const NIGHT_IST = new Date('2026-11-01T18:00:00.000Z');

function row(overrides: Partial<NotificationPreferenceRow> = {}): NotificationPreferenceRow {
  return {
    id: 'pref-1',
    userId: USER,
    emailEnabled: true,
    smsEnabled: false,
    pushEnabled: true,
    socketEnabled: true,
    whatsappEnabled: false,
    appointmentEnabled: true,
    ehrEnabled: true,
    billingEnabled: true,
    systemEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: null,
    categoryPreferences: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function plan(
  source: Parameters<typeof normalizePreferenceFlags>[0],
  channels: Parameters<typeof filterChannelsByPreferences>[0],
  options: Parameters<typeof filterChannelsByPreferences>[3] = {}
): ReturnType<typeof filterChannelsByPreferences> {
  const prefs = toUserCommunicationPreferences(USER, normalizePreferenceFlags(source));
  return filterChannelsByPreferences(channels, new Map([[USER, prefs]]), [{ userId: USER }], {
    now: AFTERNOON_IST,
    ...options,
  });
}

describe('D2 regression: the cached SWR envelope', () => {
  // The exact value Dragonfly held for REL-201 (no NotificationPreference row) on 1 Nov 2026.
  const envelope: PreferenceSource = {
    data: {
      id: '',
      userId: USER,
      emailEnabled: true,
      smsEnabled: true,
      pushEnabled: true,
      socketEnabled: true,
      whatsappEnabled: false,
      appointmentEnabled: true,
      ehrEnabled: true,
      billingEnabled: true,
      systemEnabled: true,
      createdAt: '2026-11-01T08:27:11.266Z',
      updatedAt: '2026-11-01T08:27:11.266Z',
    },
    timestamp: 1793521631266,
  };

  it('reads the flags inside the envelope instead of treating every channel as off', () => {
    expect(plan(envelope, ['socket', 'push'])).toEqual(['socket', 'push']);
  });

  it('plans the queue alert and the medicine-desk milestone as PENDING (not SKIPPED)', () => {
    const queueAlert = plan(envelope, ['socket', 'push'], {
      category: CommunicationCategory.APPOINTMENT,
      priority: CommunicationPriority.HIGH,
    });
    expect(initialNotificationState(queueAlert, { userId: USER }).status).toBe('PENDING');

    const desk = plan(envelope, ['socket', 'push', 'whatsapp', 'email'], {
      category: CommunicationCategory.PRESCRIPTION,
    });
    expect(desk).toEqual(['socket', 'push', 'email']);
    const state = initialNotificationState(desk, { userId: USER }, true);
    expect(state).toMatchObject({ status: 'PENDING', channel: 'socket', failureReason: null });
  });
});

describe('default preferences', () => {
  it('no stored preferences at all means in-app, push and email ON', () => {
    expect(plan(null, ['socket', 'push', 'email', 'whatsapp', 'sms'])).toEqual([
      'socket',
      'push',
      'email',
    ]);
  });

  it('a missing or non-boolean flag keeps its default instead of switching the channel off', () => {
    expect(plan({ id: '', userId: USER }, ['socket', 'push'])).toEqual(['socket', 'push']);
    expect(plan({ pushEnabled: 'yes', socketEnabled: null }, ['socket', 'push'])).toEqual([
      'socket',
      'push',
    ]);
  });

  it('SMS stays opt-in: the implicit defaults never send it, a saved opt-in does', () => {
    expect(plan(notificationPreferenceView(USER, null), ['sms'])).toEqual([]);
    const saved = notificationPreferenceView(USER, row({ smsEnabled: true }));
    expect(plan(saved, ['sms'])).toEqual(['sms']);
  });

  it('doctors default to WhatsApp on, everyone else off', () => {
    expect(defaultPreferenceFlags('DOCTOR').whatsappEnabled).toBe(true);
    expect(defaultPreferenceFlags('PATIENT').whatsappEnabled).toBe(false);
    expect(notificationPreferenceView(USER, null, 'DOCTOR').whatsappEnabled).toBe(true);
  });
});

describe('explicit opt-outs', () => {
  it('a switched-off channel is dropped, the others stay', () => {
    const view = notificationPreferenceView(USER, row({ pushEnabled: false }));
    expect(plan(view, ['socket', 'push'])).toEqual(['socket']);
  });

  it('a switched-off category drops every channel of that category only', () => {
    const view = notificationPreferenceView(USER, row({ appointmentEnabled: false }));
    expect(
      plan(view, ['socket', 'push'], {
        category: CommunicationCategory.APPOINTMENT,
      })
    ).toEqual([]);
    expect(
      plan(view, ['socket', 'push'], {
        category: CommunicationCategory.PRESCRIPTION,
      })
    ).toEqual(['socket', 'push']);
  });

  it('per-category channel lists restrict that category', () => {
    const view = notificationPreferenceView(
      USER,
      row({ categoryPreferences: { prescription: ['socket'], bogus: 'x' } })
    );
    expect(
      plan(view, ['socket', 'push'], {
        category: CommunicationCategory.PRESCRIPTION,
      })
    ).toEqual(['socket']);
  });

  it('a channel any addressed user switched off is not used for the request', () => {
    const on = toUserCommunicationPreferences('a', defaultPreferenceFlags());
    const off = toUserCommunicationPreferences(
      'b',
      normalizePreferenceFlags(
        notificationPreferenceView('b', row({ userId: 'b', pushEnabled: false }))
      )
    );
    const map = new Map([
      ['a', on],
      ['b', off],
    ]);
    expect(
      filterChannelsByPreferences(['socket', 'push'], map, [{ userId: 'a' }, { userId: 'b' }])
    ).toEqual(['socket']);
  });
});

describe('quiet hours in IST', () => {
  const quiet = notificationPreferenceView(
    USER,
    row({ quietHoursStart: '22:00', quietHoursEnd: '08:00' })
  );

  it('a window without a time zone is read in IST', () => {
    expect(normalizePreferenceFlags(quiet).quietHours?.timezone).toBe(QUIET_HOURS_DEFAULT_TIMEZONE);
    expect(wallClockMinutes(AFTERNOON_IST, QUIET_HOURS_DEFAULT_TIMEZONE)).toBe(13 * 60 + 58);
  });

  it('13:00 IST is outside 22:00-08:00 IST (read in UTC it is 07:30, inside the window)', () => {
    const onePmIst = new Date('2026-11-01T07:30:00.000Z');
    expect(plan(quiet, ['socket', 'push'], { now: onePmIst })).toEqual(['socket', 'push']);
    expect(plan(quiet, ['socket', 'push'])).toEqual(['socket', 'push']);
    expect(isWithinQuietHours(onePmIst, { start: '22:00', end: '08:00', timezone: 'UTC' })).toBe(
      true
    );
  });

  it('inside quiet hours only the silent in-app inbox is kept', () => {
    expect(plan(quiet, ['socket', 'push', 'email'], { now: NIGHT_IST })).toEqual(['socket']);
  });

  it('a CRITICAL notification ignores quiet hours', () => {
    expect(
      plan(quiet, ['socket', 'push'], { now: NIGHT_IST, priority: CommunicationPriority.CRITICAL })
    ).toEqual(['socket', 'push']);
  });

  it('the end minute is outside the window; same-day windows and bad input work', () => {
    const at = (iso: string): Date => new Date(iso);
    const window = { start: '22:00', end: '08:00', timezone: QUIET_HOURS_DEFAULT_TIMEZONE };
    expect(isWithinQuietHours(at('2026-11-01T02:29:00.000Z'), window)).toBe(true); // 07:59 IST
    expect(isWithinQuietHours(at('2026-11-01T02:30:00.000Z'), window)).toBe(false); // 08:00 IST
    const lunch = { start: '13:00', end: '14:00', timezone: QUIET_HOURS_DEFAULT_TIMEZONE };
    expect(isWithinQuietHours(AFTERNOON_IST, lunch)).toBe(true);
    expect(isWithinQuietHours(AFTERNOON_IST, { ...lunch, end: '13:00' })).toBe(false);
    expect(normalizePreferenceFlags({ quietHours: { start: '25:00' } }).quietHours).toBeNull();
    expect(
      normalizePreferenceFlags({ quietHours: { start: '22:00', timezone: 'Mars/Base' } }).quietHours
    ).toEqual({ start: '22:00', end: '08:00', timezone: QUIET_HOURS_DEFAULT_TIMEZONE });
  });
});
