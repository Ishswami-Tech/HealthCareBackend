/** Locales the web and mobile apps support. */
export const LOCALIZED_PROFILE_LOCALES = ['en', 'hi', 'mr'] as const;
export type ProfileLocale = (typeof LOCALIZED_PROFILE_LOCALES)[number];

export const LOCALIZED_PROFILE_LIMITS = {
  nameMax: 120,
  headlineMax: 300,
  highlightsMax: 20,
  highlightTextMax: 200,
  highlightIconMax: 8,
} as const;

export interface LocalizedProfileHighlight {
  icon?: string;
  text: string;
}

export interface LocalizedProfileEntry {
  name?: string;
  headline?: string;
  highlights?: LocalizedProfileHighlight[];
}

export type LocalizedProfile = Partial<Record<ProfileLocale, LocalizedProfileEntry>>;

const ENTRY_KEYS = new Set(['name', 'headline', 'highlights']);
const HIGHLIGHT_KEYS = new Set(['icon', 'text']);

/** Replaces C0 / DEL / C1 control characters with a space (ZWJ and variation selectors survive). */
function stripControlChars(value: string): string {
  return Array.from(value, ch => {
    const code = ch.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }).join('');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Thrown for invalid input; callers map it to a 400 (kept framework-free so the helper stays pure). */
export class LocalizedProfileValidationError extends Error {
  constructor(message: string) {
    super(`localizedProfile: ${message}`);
    this.name = 'LocalizedProfileValidationError';
  }
}

function fail(message: string): never {
  throw new LocalizedProfileValidationError(message);
}

function cleanString(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') fail(`${path} must be a string`);
  const cleaned = stripControlChars(value).replace(/\s+/g, ' ').trim();
  if (Array.from(cleaned).length > max) fail(`${path} must be at most ${max} characters`);
  return cleaned;
}

function optionalString(value: unknown, path: string, max: number): string {
  return value === undefined || value === null ? '' : cleanString(value, path, max);
}

function assertKnownKeys(obj: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) fail(`unknown field '${key}' in ${path}`);
  }
}

function normalizeHighlight(raw: unknown, path: string): LocalizedProfileHighlight | null {
  if (!isPlainObject(raw)) fail(`${path} must be an object`);
  assertKnownKeys(raw, HIGHLIGHT_KEYS, path);
  const text = optionalString(
    raw['text'],
    `${path}.text`,
    LOCALIZED_PROFILE_LIMITS.highlightTextMax
  );
  if (!text) return null;
  const icon = optionalString(
    raw['icon'],
    `${path}.icon`,
    LOCALIZED_PROFILE_LIMITS.highlightIconMax
  );
  return icon ? { icon, text } : { text };
}

function normalizeEntry(raw: unknown, locale: string): LocalizedProfileEntry | null {
  if (!isPlainObject(raw)) fail(`${locale} must be an object`);
  assertKnownKeys(raw, ENTRY_KEYS, locale);
  const entry: LocalizedProfileEntry = {};

  const name = optionalString(raw['name'], `${locale}.name`, LOCALIZED_PROFILE_LIMITS.nameMax);
  if (name) entry.name = name;

  const headline = optionalString(
    raw['headline'],
    `${locale}.headline`,
    LOCALIZED_PROFILE_LIMITS.headlineMax
  );
  if (headline) entry.headline = headline;

  const rawHighlights = raw['highlights'];
  if (rawHighlights !== undefined && rawHighlights !== null) {
    if (!Array.isArray(rawHighlights)) fail(`${locale}.highlights must be an array`);
    if (rawHighlights.length > LOCALIZED_PROFILE_LIMITS.highlightsMax) {
      fail(
        `${locale}.highlights must have at most ${LOCALIZED_PROFILE_LIMITS.highlightsMax} items`
      );
    }
    const highlights = (rawHighlights as unknown[])
      .map((item, i) => normalizeHighlight(item, `${locale}.highlights[${i}]`))
      .filter((h): h is LocalizedProfileHighlight => h !== null);
    if (highlights.length > 0) entry.highlights = highlights;
  }

  return Object.keys(entry).length > 0 ? entry : null;
}

/**
 * Validates and normalises a doctor's per-language profile text.
 * Returns a clean object, or null when nothing meaningful remains (null/undefined/empty input).
 * Throws LocalizedProfileValidationError on unknown locales/fields, wrong types or over-long values.
 */
export function normalizeLocalizedProfile(input: unknown): LocalizedProfile | null {
  if (input === undefined || input === null) return null;
  if (!isPlainObject(input)) fail('must be an object keyed by locale (en, hi, mr)');

  const allowed: readonly string[] = LOCALIZED_PROFILE_LOCALES;
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      fail(`unsupported locale '${key}' (allowed: ${LOCALIZED_PROFILE_LOCALES.join(', ')})`);
    }
  }

  const result: LocalizedProfile = {};
  for (const locale of LOCALIZED_PROFILE_LOCALES) {
    const raw = input[locale];
    if (raw === undefined || raw === null) continue;
    const entry = normalizeEntry(raw, locale);
    if (entry) result[locale] = entry;
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Picks the profile text for a locale: requested locale -> en -> first available.
 * Tolerates null/malformed stored data (returns null).
 */
export function pickLocalizedProfile(
  profile: unknown,
  locale?: string | null
): LocalizedProfileEntry | null {
  if (!isPlainObject(profile)) return null;
  const usable = (key: string | null | undefined): LocalizedProfileEntry | null => {
    if (!key) return null;
    const candidate = profile[key];
    return isPlainObject(candidate) && Object.keys(candidate).length > 0
      ? (candidate as LocalizedProfileEntry)
      : null;
  };
  const base = locale ? (locale.toLowerCase().split(/[-_]/)[0] ?? null) : null;
  const first = Object.keys(profile)
    .map(usable)
    .find(e => e !== null);
  return usable(base) ?? usable('en') ?? first ?? null;
}
