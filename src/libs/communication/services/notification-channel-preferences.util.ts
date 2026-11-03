/**
 * A recipient's notification preferences and the channels they leave for one notification
 * (pure, no Nest imports).
 *
 * D2 (release E2E, 1 Nov 2026): "You're next" and "Medicines ready to collect" were stored
 * SKIPPED "No channel left after notification preferences / quiet hours" for a patient with
 * default preferences and a registered device. NotificationPreferenceService fills the key
 * `notification_preferences:<userId>` through CacheService.cache(), which stores the value in an
 * SWR envelope `{ data, timestamp }`; CommunicationService read the same key with a plain get()
 * and took the envelope for the preferences, so every `<channel>Enabled` flag was undefined and
 * every channel counted as switched off. The preferences are now read from one shape (this file
 * builds it for both services, CacheService.cache() for both reads), an envelope is unwrapped
 * defensively, and a flag that is missing or not a boolean falls back to its default (ON for
 * in-app, push and email) instead of OFF.
 *
 * Quiet hours: evaluated in the window's own time zone, IST when none was given (the clinics are
 * in India; the old default 'UTC' made 22:00-08:00 run from 03:30 to 13:30 IST). During quiet
 * hours only the silent in-app inbox (socket) is kept; a CRITICAL notification ignores them.
 */

import { CommunicationPriority } from '@core/types/communication.types';
import type {
  CommunicationCategory,
  CommunicationChannel,
  UserCommunicationPreferences,
} from '@core/types/communication.types';

export const QUIET_HOURS_DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_QUIET_END = '08:00';
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KNOWN_CHANNELS: ReadonlySet<CommunicationChannel> = new Set([
  'socket',
  'push',
  'email',
  'sms',
  'whatsapp',
]);
/** Channels that may still carry a notification during quiet hours (silent in-app inbox). */
const QUIET_HOURS_CHANNELS: ReadonlySet<CommunicationChannel> = new Set(['socket']);

type SourceValue = string | number | boolean | Date | object | null | undefined;
/** A stored or cached preference object, of any of the shapes it has been written in. */
export type PreferenceSource = Readonly<Record<string, SourceValue>>;

export interface QuietHoursWindow {
  readonly start: string;
  readonly end: string;
  readonly timezone: string;
}

export interface PreferenceFlags {
  /** True when the user saved preferences (a stored row), false for the implicit defaults. */
  readonly explicit: boolean;
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly socketEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly appointmentEnabled: boolean;
  readonly ehrEnabled: boolean;
  readonly billingEnabled: boolean;
  readonly systemEnabled: boolean;
  readonly quietHours: QuietHoursWindow | null;
  readonly categoryPreferences: Readonly<Record<string, CommunicationChannel[]>> | null;
}

/** The stored NotificationPreference row (the columns this file reads). */
export interface NotificationPreferenceRow {
  readonly id: string;
  readonly userId: string;
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly socketEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly appointmentEnabled: boolean;
  readonly ehrEnabled: boolean;
  readonly billingEnabled: boolean;
  readonly systemEnabled: boolean;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly quietHoursTimezone: string | null;
  readonly categoryPreferences: Record<string, SourceValue> | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** The cached preference view (GET /notification-preferences and channel planning). */
export interface NotificationPreferenceView {
  readonly id: string;
  readonly userId: string;
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly socketEnabled: boolean;
  readonly whatsappEnabled: boolean;
  readonly appointmentEnabled: boolean;
  readonly ehrEnabled: boolean;
  readonly billingEnabled: boolean;
  readonly systemEnabled: boolean;
  readonly quietHours?: { start: string; end?: string; timezone: string } | undefined;
  readonly categoryPreferences?: Record<string, SourceValue> | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type FlagKey = Exclude<keyof PreferenceFlags, 'explicit' | 'quietHours' | 'categoryPreferences'>;

/** Defaults of a user who never saved preferences: everything on but WhatsApp (doctors: on). */
export function defaultPreferenceFlags(role?: string | null): PreferenceFlags {
  return {
    explicit: false,
    emailEnabled: true,
    smsEnabled: true,
    pushEnabled: true,
    socketEnabled: true,
    whatsappEnabled: String(role ?? '').toUpperCase() === 'DOCTOR',
    appointmentEnabled: true,
    ehrEnabled: true,
    billingEnabled: true,
    systemEnabled: true,
    quietHours: null,
    categoryPreferences: null,
  };
}

/** The view cached for a user: the stored row, or the defaults when there is none. */
export function notificationPreferenceView(
  userId: string,
  row: NotificationPreferenceRow | null | undefined,
  role?: string | null,
  now: Date = new Date()
): NotificationPreferenceView {
  if (!row?.id) {
    const defaults = defaultPreferenceFlags(role);
    return {
      id: '',
      userId,
      emailEnabled: defaults.emailEnabled,
      smsEnabled: defaults.smsEnabled,
      pushEnabled: defaults.pushEnabled,
      socketEnabled: defaults.socketEnabled,
      whatsappEnabled: defaults.whatsappEnabled,
      appointmentEnabled: defaults.appointmentEnabled,
      ehrEnabled: defaults.ehrEnabled,
      billingEnabled: defaults.billingEnabled,
      systemEnabled: defaults.systemEnabled,
      quietHours: undefined,
      categoryPreferences: undefined,
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    id: row.id,
    userId: row.userId,
    emailEnabled: row.emailEnabled,
    smsEnabled: row.smsEnabled,
    pushEnabled: row.pushEnabled,
    socketEnabled: row.socketEnabled,
    whatsappEnabled: row.whatsappEnabled,
    appointmentEnabled: row.appointmentEnabled,
    ehrEnabled: row.ehrEnabled,
    billingEnabled: row.billingEnabled,
    systemEnabled: row.systemEnabled,
    quietHours: row.quietHoursStart
      ? {
          start: row.quietHoursStart,
          ...(row.quietHoursEnd ? { end: row.quietHoursEnd } : {}),
          timezone: row.quietHoursTimezone || QUIET_HOURS_DEFAULT_TIMEZONE,
        }
      : undefined,
    categoryPreferences: row.categoryPreferences ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const asSource = (value: SourceValue): PreferenceSource | null =>
  value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    ? (value as PreferenceSource)
    : null;

/** The preference object itself, also when it arrives inside a cache envelope `{ data, ... }`. */
function unwrapEnvelope(source: PreferenceSource): PreferenceSource {
  const inner = asSource(source['data']);
  const looksLikeFlags = Object.keys(source).some(key => key.endsWith('Enabled'));
  return inner && !looksLikeFlags ? inner : source;
}

/** True when the time zone is one Intl knows. */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function quietHoursFrom(value: SourceValue): QuietHoursWindow | null {
  const window = asSource(value);
  const start = typeof window?.['start'] === 'string' ? window['start'].trim() : '';
  if (!HH_MM.test(start)) return null;
  const end = typeof window?.['end'] === 'string' ? window['end'].trim() : '';
  const timezone = typeof window?.['timezone'] === 'string' ? window['timezone'].trim() : '';
  return {
    start,
    end: HH_MM.test(end) ? end : DEFAULT_QUIET_END,
    timezone: timezone && isKnownTimezone(timezone) ? timezone : QUIET_HOURS_DEFAULT_TIMEZONE,
  };
}

function categoryPreferencesFrom(
  value: SourceValue
): Readonly<Record<string, CommunicationChannel[]>> | null {
  const record = asSource(value);
  if (!record) return null;
  const result: Record<string, CommunicationChannel[]> = {};
  for (const [category, channels] of Object.entries(record)) {
    if (!Array.isArray(channels)) continue;
    result[category.toLowerCase()] = channels.filter(
      (channel): channel is CommunicationChannel =>
        typeof channel === 'string' && KNOWN_CHANNELS.has(channel as CommunicationChannel)
    );
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Flags from a stored / cached preference object of any shape (flat view, cache envelope, or
 * nothing). A flag that is missing or not a boolean keeps its default.
 */
export function normalizePreferenceFlags(
  source: PreferenceSource | NotificationPreferenceView | null | undefined,
  defaults: PreferenceFlags = defaultPreferenceFlags()
): PreferenceFlags {
  const record = asSource(source);
  if (!record) return defaults;
  const view = unwrapEnvelope(record);
  const flag = (key: FlagKey): boolean => {
    const value = view[key];
    return typeof value === 'boolean' ? value : defaults[key];
  };
  const id = view['id'];
  return {
    explicit: typeof id === 'string' && id.length > 0,
    emailEnabled: flag('emailEnabled'),
    smsEnabled: flag('smsEnabled'),
    pushEnabled: flag('pushEnabled'),
    socketEnabled: flag('socketEnabled'),
    whatsappEnabled: flag('whatsappEnabled'),
    appointmentEnabled: flag('appointmentEnabled'),
    ehrEnabled: flag('ehrEnabled'),
    billingEnabled: flag('billingEnabled'),
    systemEnabled: flag('systemEnabled'),
    quietHours: quietHoursFrom(view['quietHours']),
    categoryPreferences: categoryPreferencesFrom(view['categoryPreferences']),
  };
}

/** Preferences in the shape CommunicationService plans channels with. */
export function toUserCommunicationPreferences(
  userId: string,
  flags: PreferenceFlags
): UserCommunicationPreferences & { smsEnabled: boolean; explicit: boolean } {
  const byChannel: ReadonlyArray<readonly [CommunicationChannel, boolean]> = [
    ['email', flags.emailEnabled],
    ['sms', flags.smsEnabled],
    ['push', flags.pushEnabled],
    ['socket', flags.socketEnabled],
    ['whatsapp', flags.whatsappEnabled],
  ];
  return {
    userId,
    explicit: flags.explicit,
    smsEnabled: flags.smsEnabled,
    enabledChannels: byChannel.filter(([, on]) => on).map(([channel]) => channel),
    disabledChannels: byChannel.filter(([, on]) => !on).map(([channel]) => channel),
    ...(flags.categoryPreferences ? { categoryPreferences: { ...flags.categoryPreferences } } : {}),
    ...(flags.quietHours ? { quietHours: { ...flags.quietHours } } : {}),
    appointmentEnabled: flags.appointmentEnabled,
    ehrEnabled: flags.ehrEnabled,
    billingEnabled: flags.billingEnabled,
    systemEnabled: flags.systemEnabled,
  };
}

function minutesOf(hhmm: string): number | null {
  const match = HH_MM.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight of `now` on the wall clock of `timezone`. */
export function wallClockMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: isKnownTimezone(timezone) ? timezone : QUIET_HOURS_DEFAULT_TIMEZONE,
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  return (hour % 24) * 60 + minute;
}

/** True inside [start, end) on the window's wall clock; a window may span midnight. */
export function isWithinQuietHours(
  now: Date,
  window: QuietHoursWindow | null | undefined
): boolean {
  if (!window) return false;
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === null || end === null || start === end) return false;
  const current = wallClockMinutes(now, window.timezone || QUIET_HOURS_DEFAULT_TIMEZONE);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export interface ChannelPlanRecipient {
  readonly userId?: string | undefined;
}

export interface ChannelPlanOptions {
  readonly category?: CommunicationCategory | undefined;
  readonly priority?: CommunicationPriority | undefined;
  readonly now?: Date | undefined;
}

type PlanningPreferences = UserCommunicationPreferences & {
  smsEnabled?: boolean;
  explicit?: boolean;
};

const CATEGORY_SWITCH: Readonly<
  Record<string, 'appointmentEnabled' | 'ehrEnabled' | 'billingEnabled' | 'systemEnabled'>
> = {
  appointment: 'appointmentEnabled',
  ehr: 'ehrEnabled',
  ehr_record: 'ehrEnabled',
  billing: 'billingEnabled',
  system: 'systemEnabled',
};

/** Whether one recipient's preferences let `channel` carry the notification. */
function recipientAllows(
  channel: CommunicationChannel,
  prefs: PlanningPreferences,
  options: ChannelPlanOptions,
  now: Date
): boolean {
  const categoryKey = options.category ? String(options.category).toLowerCase() : '';
  const categoryChannels = categoryKey ? prefs.categoryPreferences?.[categoryKey] : undefined;
  const restrictsChannels = Array.isArray(categoryChannels) && categoryChannels.length > 0;

  // SMS is opt-in: only for a user who saved preferences with SMS on.
  if (channel === 'sms' && (prefs.explicit !== true || prefs.smsEnabled !== true)) return false;
  if (
    options.priority !== CommunicationPriority.CRITICAL &&
    !QUIET_HOURS_CHANNELS.has(channel) &&
    isWithinQuietHours(now, prefs.quietHours)
  ) {
    return false;
  }
  if (restrictsChannels && !categoryChannels.includes(channel)) return false;
  const categorySwitch = CATEGORY_SWITCH[categoryKey];
  if (categorySwitch && prefs[categorySwitch] === false) return false;
  if (prefs.disabledChannels.includes(channel)) return false;
  return prefs.enabledChannels.length === 0 || prefs.enabledChannels.includes(channel);
}

/**
 * The requested channels (order kept, no repeats) every addressed user's preferences allow.
 * Without any preferences only SMS is dropped (opt-in).
 */
export function filterChannelsByPreferences(
  channels: readonly CommunicationChannel[],
  preferences: ReadonlyMap<string, PlanningPreferences> | undefined,
  recipients: readonly ChannelPlanRecipient[],
  options: ChannelPlanOptions = {}
): CommunicationChannel[] {
  const unique = Array.from(new Set(channels));
  if (!preferences || preferences.size === 0) {
    return unique.filter(channel => channel !== 'sms');
  }
  const now = options.now ?? new Date();
  const addressed = recipients
    .map(recipient => (recipient.userId ? preferences.get(recipient.userId) : undefined))
    .filter((prefs): prefs is PlanningPreferences => prefs !== undefined);
  return unique.filter(channel =>
    addressed.every(prefs => recipientAllows(channel, prefs, options, now))
  );
}
