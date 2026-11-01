/**
 * Notification recipients must be addressed by User.id (the inbox row, the socket room
 * `user:<id>` and the push devices are all keyed by it). Several events carry a profile id
 * instead - e.g. `doctor.availability.changed` emits Doctor.id - which CommunicationService then
 * drops as "user not found". This remaps such ids to the owning user (pure, unit-tested; the
 * caller loads the Doctor.id -> Doctor.userId pairs in one query).
 */

export interface NotificationRecipient {
  userId?: string;
  email?: string;
  phoneNumber?: string;
  deviceToken?: string;
  socketRoom?: string;
}

type PayloadValue = string | number | boolean | object | null | undefined;
type PayloadRecord = Readonly<Record<string, PayloadValue>>;

const QUEUE_BOARD_EVENT = /^appointment\.queue\.(updated|reordered)$/;

const asPayloadRecord = (value: PayloadValue): PayloadRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PayloadRecord) : null;

const hasText = (record: PayloadRecord | null, key: string): boolean => {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0;
};

/**
 * `appointment.queue.updated` / `.reordered` are queue-BOARD refreshes (check-in, start, reorder,
 * remove, priority) for the staff screens: AppointmentQueueService emits them with the doctor /
 * clinic / entry ids and never a patient. They are not a patient notification, so the listener
 * skips them (logged at INFO) instead of failing to build one ("missing patientId"). One that
 * does name a patient (userId / patientId at the top level, in metadata or in `payload`) is
 * still notified.
 */
export function isQueueBoardEventWithoutPatient(eventType: string, event: PayloadRecord): boolean {
  if (!QUEUE_BOARD_EVENT.test(eventType)) return false;
  const records = [event, asPayloadRecord(event['metadata']), asPayloadRecord(event['payload'])];
  return !records.some(record => hasText(record, 'userId') || hasText(record, 'patientId'));
}

/** Distinct userIds of the recipients (the ids to look up as profile ids). */
export function recipientUserIds(recipients: readonly NotificationRecipient[]): string[] {
  return Array.from(
    new Set(recipients.map(recipient => recipient.userId).filter((id): id is string => !!id))
  );
}

/**
 * Replaces every userId found in `profileToUser` (and its `user:<id>` socket room) with the
 * owning user's id; other recipients are kept as-is. A user addressed twice (e.g. by both ids)
 * is kept once.
 */
export function remapRecipientUserIds<Recipient extends NotificationRecipient>(
  recipients: readonly Recipient[],
  profileToUser: ReadonlyMap<string, string>
): Recipient[] {
  const seen = new Set<string>();
  const result: Recipient[] = [];
  for (const recipient of recipients) {
    const mapped = recipient.userId ? profileToUser.get(recipient.userId) : undefined;
    const next: Recipient =
      mapped && recipient.userId
        ? {
            ...recipient,
            userId: mapped,
            ...(recipient.socketRoom === `user:${recipient.userId}`
              ? { socketRoom: `user:${mapped}` }
              : {}),
          }
        : recipient;
    if (next.userId) {
      const key = `${next.userId}|${next.socketRoom ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    result.push(next);
  }
  return result;
}
