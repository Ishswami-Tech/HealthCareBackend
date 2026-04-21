const UUID_V4_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function normalizeAppointmentId(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  const uuidMatch = trimmedValue.match(UUID_V4_PATTERN);
  if (uuidMatch?.[0]) {
    return uuidMatch[0];
  }

  return trimmedValue;
}
