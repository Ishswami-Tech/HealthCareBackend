/**
 * Maps one row of the Vaidya Manager patient register export to the Doctor APP's data model.
 * Pure functions: no I/O, no database, no framework imports.
 *
 * Principles (see docs/compliance/README.md):
 *  - Record what the source says; never invent. Unusable values become null plus an `issue` code
 *    that is counted in the report, so data quality is visible and nothing is silently dropped.
 *  - Contact details are contact points, not login identities.
 *  - No consent and no clinical content beyond what the register contains.
 */

export const REGISTER_HEADERS = [
  'UHID No',
  'OPD No',
  'Case Date',
  'Patient Name',
  'Mobile',
  'Age',
  'Gender',
  'DOB',
  'Email',
  'Address',
  'City Name',
  'State',
  'Country',
  'Reference',
  'Reference',
  'Ayurved Diagnosis',
  'Modern Diagnosis',
  'Morden System',
] as const;

export type RegisterIssue =
  | 'AGE_OUT_OF_RANGE'
  | 'DOB_INVALID'
  | 'EMAIL_INVALID'
  | 'MOBILE_UNUSABLE'
  | 'GENDER_UNKNOWN'
  | 'OPD_MISSING'
  | 'COUNTRY_NORMALISED';

export interface MappedRegisterRow {
  readonly rowNumber: number;
  /** The old register's patient number, kept as a LEGACY_REGISTRATION identifier (not the UHID). */
  readonly legacyRegistration: string;
  readonly legacyOpd: string | null;
  /** Calendar date of the case, as YYYY-MM-DD (India time). */
  readonly caseDate: string;
  readonly name: string;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly gender: 'MALE' | 'FEMALE' | null;
  readonly age: number | null;
  readonly dateOfBirth: string | null;
  readonly email: string | null;
  /** E.164, e.g. +919876543210. */
  readonly mobile: string | null;
  readonly address: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly referenceSource: string | null;
  readonly ayurvedicDiagnosis: string | null;
  readonly modernDiagnosis: string | null;
  readonly issues: readonly RegisterIssue[];
}

export type RowResult =
  | { readonly ok: true; readonly row: MappedRegisterRow }
  | { readonly ok: false; readonly rowNumber: number; readonly reason: string };

const MAX = { name: 120, address: 300, place: 80, reference: 40, diagnosis: 200, id: 64 } as const;
const MIN_YEAR = 2000;
const MAX_AGE = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const isControlCharacter = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
};

const clean = (value: string | undefined): string =>
  Array.from(value ?? '')
    .map(char => (isControlCharacter(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

const orNull = (value: string, max: number): string | null =>
  value === '' || value === '-' ? null : value.slice(0, max);

function parseDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, d, m, y] = match;
  const day = Number(d);
  const month = Number(m);
  const year = Number(y);
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

/** Ten-digit Indian mobile numbers, with or without +91 / 91 / leading 0, as +91XXXXXXXXXX. */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().+]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  let national = digits;
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  else if (national.length === 11 && national.startsWith('0')) national = national.slice(1);
  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}

export function mapRegisterRow(
  cells: readonly string[],
  rowNumber: number,
  today: Date
): RowResult {
  const cell = (index: number): string => clean(cells[index]);
  const issues: RegisterIssue[] = [];

  const legacyRegistration = cell(0).slice(0, MAX.id);
  if (legacyRegistration === '') return { ok: false, rowNumber, reason: 'missing register number' };

  const caseDate = parseDate(cell(2));
  if (!caseDate)
    return { ok: false, rowNumber, reason: 'case date is not a valid dd/mm/yyyy date' };
  const caseYear = Number(caseDate.slice(0, 4));
  if (caseYear < MIN_YEAR || new Date(`${caseDate}T00:00:00Z`) > today) {
    return { ok: false, rowNumber, reason: 'case date is outside the plausible range' };
  }

  const name = cell(3).slice(0, MAX.name);
  if (name === '') return { ok: false, rowNumber, reason: 'missing patient name' };
  const [firstName = name, ...rest] = name.split(' ');
  const lastName = rest.length > 0 ? rest.join(' ') : null;

  const genderText = cell(6).toLowerCase();
  const gender = genderText === 'male' ? 'MALE' : genderText === 'female' ? 'FEMALE' : null;
  if (gender === null) issues.push('GENDER_UNKNOWN');

  const ageText = cell(5);
  let age: number | null = null;
  if (ageText !== '' && ageText !== '-') {
    const parsed = Number(ageText);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_AGE) age = parsed;
    else issues.push('AGE_OUT_OF_RANGE');
  }

  const dobText = cell(7);
  let dateOfBirth: string | null = null;
  if (dobText !== '' && dobText !== '-') {
    const parsed = parseDate(dobText);
    if (parsed && new Date(`${parsed}T00:00:00Z`) <= today && Number(parsed.slice(0, 4)) > 1900) {
      dateOfBirth = parsed;
    } else {
      issues.push('DOB_INVALID');
    }
  }

  const emailText = cell(8).toLowerCase();
  let email: string | null = null;
  if (emailText !== '') {
    if (EMAIL_PATTERN.test(emailText) && emailText.length <= 254) email = emailText;
    else issues.push('EMAIL_INVALID');
  }

  const mobileText = cell(4);
  let mobile: string | null = null;
  if (mobileText !== '') {
    mobile = normaliseIndianMobile(mobileText);
    if (mobile === null) issues.push('MOBILE_UNUSABLE');
  }

  const legacyOpd = orNull(cell(1), MAX.id);
  if (legacyOpd === null) issues.push('OPD_MISSING');

  let country = orNull(cell(12), MAX.place);
  if (country !== null && /^india\b/i.test(country) && country !== 'India') {
    country = 'India';
    issues.push('COUNTRY_NORMALISED');
  }

  const modern = orNull(cell(16), MAX.diagnosis);
  const modernSystem = orNull(cell(17), MAX.diagnosis);
  // "Morden System" is usually a free-text repeat of the modern diagnosis: keep it only when it adds something.
  const modernDiagnosis =
    modern && modernSystem && modern.toLowerCase() !== modernSystem.toLowerCase()
      ? `${modern}; ${modernSystem}`
      : (modern ?? modernSystem);

  return {
    ok: true,
    row: {
      rowNumber,
      legacyRegistration,
      legacyOpd,
      caseDate,
      name,
      firstName,
      lastName,
      gender,
      age,
      dateOfBirth,
      email,
      mobile,
      address: orNull(cell(9), MAX.address),
      city: orNull(cell(10), MAX.place),
      state: orNull(cell(11), MAX.place),
      country,
      referenceSource: orNull(cell(13), MAX.reference),
      ayurvedicDiagnosis: orNull(cell(15), MAX.diagnosis),
      modernDiagnosis,
      issues,
    },
  };
}

/** The header must be exactly the known export layout; anything else means a different file. */
export function assertRegisterHeader(header: readonly string[]): void {
  const trimmed = header.map(cell => cell.trim());
  const matches =
    trimmed.length === REGISTER_HEADERS.length &&
    REGISTER_HEADERS.every((expected, index) => expected === trimmed[index]);
  if (!matches) {
    throw new Error(
      `Unexpected CSV header. Expected: ${REGISTER_HEADERS.join(', ')}. Got: ${trimmed.join(', ')}`
    );
  }
}
