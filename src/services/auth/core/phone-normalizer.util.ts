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
