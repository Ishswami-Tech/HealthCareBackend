/**
 * User ID Generation Utilities
 * Provides consistent, meaningful user ID generation across all auth flows
 */

/**
 * Generate a meaningful user ID from identifier (email or phone)
 * Format: UID_{PREFIX}_{TIMESTAMP}_{RANDOM}
 *
 * @param identifier - Email or phone number
 * @param isEmail - Whether the identifier is an email
 * @returns Human-readable, unique user ID
 */
export function generateUserId(identifier: string, isEmail: boolean): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();

  if (isEmail) {
    // Extract prefix from email
    const emailPrefix = identifier.split('@')[0] || 'USER';
    const sanitized = emailPrefix
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 12);
    return `UID_${sanitized}_${timestamp}_${randomPart}`;
  } else {
    // Use phone last 4 digits
    const phoneDigits = identifier.replace(/\D/g, '').slice(-4);
    return `UID_PH${phoneDigits}_${timestamp}_${randomPart}`;
  }
}

/**
 * Generate user ID for social auth (includes provider prefix)
 * Format: UID_{PROVIDER}_{EMAIL_PREFIX}_{TIMESTAMP}_{RANDOM}
 *
 * @param email - User's email from social provider
 * @param provider - Social auth provider (google, facebook, apple)
 * @returns User ID with provider identifier
 */
export function generateSocialUserId(email: string, provider: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  const providerPrefix = provider.toUpperCase().substring(0, 3);

  const emailPrefix = email.split('@')[0] || 'USER';
  const sanitized = emailPrefix
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 10);

  return `UID_${providerPrefix}_${sanitized}_${timestamp}_${randomPart}`;
}
