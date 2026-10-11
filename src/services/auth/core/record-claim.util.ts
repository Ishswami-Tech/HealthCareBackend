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
 * "Rahul Ganesh Barote") and at least two words agree. A single shared word is never enough,
 * unless that is all either name has.
 */
export function namesMatch(typed: string | null | undefined, stored: string | null | undefined): boolean {
  const a = new Set(nameTokens(typed));
  const b = new Set(nameTokens(stored));
  if (a.size === 0 || b.size === 0) return false;

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
    const full = candidate.name ?? [candidate.firstName, candidate.lastName].filter(Boolean).join(' ');
    return namesMatch(typedName, full);
  });
}
