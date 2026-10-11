/**
 * Matching a person's typed name against the name in an imported (old register) record.
 *
 * The caller has already proved their mobile number with a one-time code, and only records whose
 * contact number is that same number are considered. The name is the second factor: it keeps a
 * family sharing one number (or a recycled SIM) from taking each other's records.
 */

const NAME_SEPARATORS = /[\s.,'’`\-_/]+/;

/** Lower-case words of a name, without punctuation or empty parts. */
export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .split(NAME_SEPARATORS)
    .map(token => token.trim())
    .filter(token => token.length > 0);
}

/**
 * True when one name's words are all in the other's (so "Rahul Barote" matches
 * "Rahul Ganesh Barote"), at least two words agree, and the FIRST words are the same.
 *
 * The first word must agree because in Maharashtra the middle name is the father's name: a father's
 * "Ganesh Barote" is a word-subset of his son's "Rahul Ganesh Barote" and must not match it.
 * A single shared word is never enough, unless that is all either name has.
 */
export function namesMatch(
  typed: string | null | undefined,
  stored: string | null | undefined
): boolean {
  const a = new Set(nameTokens(typed));
  const b = new Set(nameTokens(stored));
  if (a.size === 0 || b.size === 0) return false;

  const firstTyped = nameTokens(typed)[0];
  const firstStored = nameTokens(stored)[0];
  if (firstTyped !== firstStored) return false;

  const aInB = [...a].every(token => b.has(token));
  const bInA = [...b].every(token => a.has(token));
  if (!aInB && !bInA) return false;

  const shared = [...a].filter(token => b.has(token)).length;
  const needed = Math.min(2, Math.max(a.size, b.size));
  return shared >= needed;
}

export interface ClaimCandidate {
  readonly patientId: string;
  readonly userId: string;
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/** The candidates whose stored name matches what the person typed. */
export function candidatesMatchingName(
  typedName: string,
  candidates: readonly ClaimCandidate[]
): ClaimCandidate[] {
  return candidates.filter(candidate => {
    const full =
      candidate.name || [candidate.firstName, candidate.lastName].filter(Boolean).join(' ');
    return namesMatch(typedName, full);
  });
}

/** Postgres 23503 (foreign key) or 23505 (unique) from a raw statement, however the driver wraps it. */
export function isForeignKeyOrUniqueViolation(error: unknown): boolean {
  const record = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown };
    cause?: { code?: unknown };
  };
  const codes = [record.code, record.meta?.code, record.cause?.code].map(value =>
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  );
  const message = typeof record.message === 'string' ? record.message : '';
  return (
    codes.some(code => code === '23503' || code === '23505') ||
    /foreign key constraint|unique constraint/i.test(message)
  );
}
