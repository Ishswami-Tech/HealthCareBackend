export function normalizeAuthPhoneNumber(phone: string): string {
  const cleaned = phone.trim().replace(/[^\d+]/g, '');

  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }
    return `+${cleaned}`;
  }

  return cleaned;
}

/**
 * Every candidate `phone` value a DB row might store for the same real number, so a lookup finds
 * an existing account regardless of which format it was saved in.
 *
 * `normalizeAuthPhoneNumber` always returns E.164 (`+91XXXXXXXXXX`), but a large share of this
 * app's own patient records store a bare 10-digit national number with no "+91" (seed data and,
 * per the evidence, at least one other write path) — an exact-match lookup on the E.164 form alone
 * misses those rows entirely, silently falling through to "no user found" and auto-registering a
 * brand-new, blank duplicate account instead of logging the real patient in. Found 2026-10-27
 * during the 100-patient live-ops test: Phone-tab login created ghost accounts for every seeded
 * patient, and the real account could then never re-verify its own number ("already registered
 * with another account").
 */
export function authPhoneLookupCandidates(phone: string): string[] {
  const e164 = normalizeAuthPhoneNumber(phone);
  const bareDigits = e164.startsWith('+91') ? e164.slice(3) : e164.replace(/^\+/, '');
  return Array.from(new Set([e164, bareDigits]));
}
