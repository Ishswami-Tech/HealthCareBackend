/** The name columns a user row carries. */
export type PersonNameFields = {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Display name from a user row: `name`, else first + last name, else ''. Never a placeholder, so
 * callers can tell "unknown" apart from a real name and choose their own fallback.
 */
export function resolveUserDisplayName(user: PersonNameFields | null | undefined): string {
  if (!user) {
    return '';
  }

  const fullName = (user.name || '').trim();
  if (fullName) {
    return fullName;
  }

  return [user.firstName, user.lastName]
    .map(part => (part || '').trim())
    .filter(Boolean)
    .join(' ');
}
