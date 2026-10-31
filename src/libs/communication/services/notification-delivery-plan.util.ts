/**
 * Which channels can carry a notification to one recipient, and the state its inbox row starts
 * in (pure, no Nest imports).
 *
 * INT-03: the row used to be created PENDING before channel eligibility was checked. When every
 * channel was then skipped (no email / phone for the patient, or preferences removed them all)
 * nothing ever wrote a log or a status, so the row stayed PENDING forever and was labelled
 * EMAIL even when email could not be sent. A row no channel can carry now starts SKIPPED with
 * the reason; otherwise it starts PENDING on the first channel that will really be attempted.
 */

import type { CommunicationChannel } from '@core/types/communication.types';

export interface DeliveryPlanRecipient {
  readonly userId?: string | undefined;
  readonly email?: string | undefined;
  readonly phoneNumber?: string | undefined;
  readonly deviceToken?: string | undefined;
  readonly socketRoom?: string | undefined;
}

export interface InitialNotificationState {
  readonly status: 'PENDING' | 'SKIPPED';
  readonly deliveryStatus: 'PENDING' | 'SKIPPED';
  readonly channel: string;
  readonly failureReason: string | null;
}

/** The recipient has the contact the channel needs. */
export function canChannelReach(
  channel: CommunicationChannel,
  recipient: DeliveryPlanRecipient
): boolean {
  switch (channel) {
    case 'email':
      return Boolean(recipient.email);
    case 'whatsapp':
    case 'sms':
      return Boolean(recipient.phoneNumber);
    case 'push':
      // The device token can be looked up from the user id.
      return Boolean(recipient.deviceToken) || Boolean(recipient.userId);
    case 'socket':
      // The room can be derived from the user id.
      return Boolean(recipient.socketRoom) || Boolean(recipient.userId);
    default:
      return true;
  }
}

/**
 * The channels (in order, without repeats) that will really be attempted for the recipient.
 * With `singleExternal`, in-app (socket) plus only the first reachable out-of-app channel.
 */
export function eligibleChannels(
  channels: readonly CommunicationChannel[],
  recipient: DeliveryPlanRecipient,
  singleExternal = false
): CommunicationChannel[] {
  const reachable = Array.from(new Set(channels)).filter(channel =>
    canChannelReach(channel, recipient)
  );
  if (!singleExternal) return reachable;
  const external = reachable.find(channel => channel !== 'socket');
  return reachable.filter(channel => channel === 'socket' || channel === external);
}

/** Start state of the recipient's inbox row. */
export function initialNotificationState(
  finalChannels: readonly CommunicationChannel[],
  recipient: DeliveryPlanRecipient,
  singleExternal = false
): InitialNotificationState {
  const eligible = eligibleChannels(finalChannels, recipient, singleExternal);
  const first = eligible[0];
  if (first) {
    return { status: 'PENDING', deliveryStatus: 'PENDING', channel: first, failureReason: null };
  }
  return {
    status: 'SKIPPED',
    deliveryStatus: 'SKIPPED',
    channel: finalChannels[0] ?? 'none',
    failureReason:
      finalChannels.length === 0
        ? 'No channel left after notification preferences / quiet hours'
        : `No contact for ${Array.from(new Set(finalChannels)).join(', ')}`,
  };
}
