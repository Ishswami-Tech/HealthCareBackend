/**
 * Pure helpers for medication adherence: turn a free-text prescription frequency
 * into a number of doses per day and build the per-dose log for a date range.
 * No Nest providers, so the rules are unit-testable without a database.
 */

/** Hard cap so a typo such as "every 1 hour" cannot create 24 log rows per day. */
export const MAX_DOSES_PER_DAY = 6;
export const DEFAULT_DOSES_PER_DAY = 1;
export const MAX_ADHERENCE_RANGE_DAYS = 90;
export const DEFAULT_ADHERENCE_RANGE_DAYS = 7;

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  once: 1,
  one: 1,
  twice: 2,
  two: 2,
  thrice: 3,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const ABBREVIATIONS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(?:qid|qds)\b/, 4],
  [/\b(?:tid|tds)\b/, 3],
  [/\b(?:bid|bd)\b/, 2],
  [/\b(?:od|qd)\b/, 1],
  [/\b(?:hs|sos|prn)\b/, 1],
];

function clampDoses(count: number): number {
  if (!Number.isFinite(count) || count < 1) {
    return DEFAULT_DOSES_PER_DAY;
  }
  return Math.min(Math.floor(count), MAX_DOSES_PER_DAY);
}

/**
 * Doses per day for a prescription frequency string.
 * Understands "1-0-1" / "1-1-1" (count of non-zero slots), "twice daily",
 * "3 times a day", "every 8 hours", BD / TDS / QID / OD. Unknown text counts as
 * one dose a day (never zero, so an unparseable medicine still shows up).
 */
export function dosesPerDay(frequency: string | null | undefined): number {
  const text = (frequency ?? '').trim().toLowerCase();
  if (text.length === 0) {
    return DEFAULT_DOSES_PER_DAY;
  }

  // Indian pattern "morning-noon-night": 1-0-1, 1-1-1-1, 0-0-1
  const pattern = text.match(/\b\d(?:\s*-\s*\d){1,3}\b/);
  if (pattern) {
    const slots = pattern[0].split('-').map(part => Number(part.trim()));
    const taken = slots.filter(slot => slot > 0).length;
    if (taken > 0) {
      return clampDoses(taken);
    }
  }

  const everyHours = text.match(/every\s+(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b/);
  if (everyHours) {
    const hours = Number(everyHours[1]);
    if (hours > 0) {
      return clampDoses(Math.floor(24 / hours));
    }
  }

  const times = text.match(/(\d{1,2})\s*(?:x|times?)\b/);
  if (times) {
    return clampDoses(Number(times[1]));
  }

  for (const [word, count] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`).test(text) && /(daily|day|times|a day|per day)/.test(text)) {
      return clampDoses(count);
    }
  }

  for (const [pattern2, count] of ABBREVIATIONS) {
    if (pattern2.test(text)) {
      return clampDoses(count);
    }
  }

  return DEFAULT_DOSES_PER_DAY;
}

/** Display label of a dose slot, e.g. "Dose 2 of 3". */
export function doseLabel(doseIndex: number, perDay: number): string {
  return `Dose ${doseIndex + 1} of ${perDay}`;
}

export type DoseStatus = 'TAKEN' | 'MISSED' | 'PENDING';

export interface ScheduledMedication {
  readonly id: string;
  readonly name: string;
  readonly frequency: string;
  /** Inclusive first day (YYYY-MM-DD, IST). */
  readonly startDay: string;
  /** Inclusive last day (YYYY-MM-DD, IST); null = ongoing. */
  readonly endDay: string | null;
}

export interface DoseLogEntry {
  readonly date: string;
  readonly medicationId: string;
  readonly medicationName: string;
  readonly doseIndex: number;
  readonly label: string;
  readonly status: DoseStatus;
  readonly takenAt: string | null;
}

export interface AdherenceSummary {
  readonly scheduledDoses: number;
  readonly takenDoses: number;
  readonly missedDoses: number;
  /** taken / (taken + missed) for days that are over; null when nothing was due yet. */
  readonly adherencePercentage: number | null;
}

/** Every YYYY-MM-DD from `from` to `to` inclusive (both already IST day keys). */
export function enumerateDays(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime() && days.length <= MAX_ADHERENCE_RANGE_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Key identifying one dose slot, used to match schedule rows against logged rows. */
export function doseKey(medicationId: string, day: string, doseIndex: number): string {
  return `${medicationId}|${day}|${doseIndex}`;
}

/**
 * Builds the dose log: one entry per scheduled dose of every medication in the
 * range. A dose is TAKEN when it was logged, MISSED when its day is before
 * `today` and it was not logged, PENDING for today and later.
 */
export function buildDoseLog(input: {
  readonly medications: readonly ScheduledMedication[];
  readonly days: readonly string[];
  readonly today: string;
  readonly taken: ReadonlyMap<string, Date>;
}): { readonly doseLog: DoseLogEntry[]; readonly summary: AdherenceSummary } {
  const doseLog: DoseLogEntry[] = [];
  let takenDoses = 0;
  let missedDoses = 0;

  for (const day of input.days) {
    for (const medication of input.medications) {
      if (day < medication.startDay || (medication.endDay !== null && day > medication.endDay)) {
        continue;
      }
      const perDay = dosesPerDay(medication.frequency);
      for (let doseIndex = 0; doseIndex < perDay; doseIndex += 1) {
        const takenAt = input.taken.get(doseKey(medication.id, day, doseIndex));
        let status: DoseStatus = 'PENDING';
        if (takenAt) {
          status = 'TAKEN';
          takenDoses += 1;
        } else if (day < input.today) {
          status = 'MISSED';
          missedDoses += 1;
        }
        doseLog.push({
          date: day,
          medicationId: medication.id,
          medicationName: medication.name,
          doseIndex,
          label: doseLabel(doseIndex, perDay),
          status,
          takenAt: takenAt ? takenAt.toISOString() : null,
        });
      }
    }
  }

  const due = takenDoses + missedDoses;
  return {
    doseLog,
    summary: {
      scheduledDoses: doseLog.length,
      takenDoses,
      missedDoses,
      adherencePercentage: due === 0 ? null : Math.round((takenDoses / due) * 100),
    },
  };
}
