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

import type { ChannelDeliveryResult, CommunicationChannel } from '@core/types/communication.types';

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

/** `skipReason` of a channel whose provider is switched off in this environment. */
export const CHANNEL_DISABLED_REASON = 'channel disabled';

/** What a channel attempt did, as the delivery log / inbox row record it. */
export type ChannelOutcomeStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface ChannelOutcome {
  readonly status: ChannelOutcomeStatus;
  /** Why it was not sent (null when SENT). */
  readonly reason: string | null;
}

export type ChannelAttemptResult = Pick<ChannelDeliveryResult, 'success' | 'error' | 'metadata'>;

/**
 * Shared convention of a channel that did not try to deliver (disabled provider, user without a
 * registered device): `success: false` plus `metadata.skipped: true` and `metadata.skipReason`.
 * Such an attempt is SKIPPED, never FAILED (nothing to retry) and never SENT.
 */
export function channelOutcome(result: ChannelAttemptResult): ChannelOutcome {
  if (result.success) return { status: 'SENT', reason: null };
  const skipReason = result.metadata?.['skipReason'];
  if (result.metadata?.['skipped'] === true) {
    return {
      status: 'SKIPPED',
      reason: typeof skipReason === 'string' && skipReason ? skipReason : result.error || 'skipped',
    };
  }
  return { status: 'FAILED', reason: result.error || 'Unknown error' };
}

/** The skipped result of a channel whose provider is disabled. */
export function channelDisabledResult<Channel extends CommunicationChannel>(
  channel: Channel,
  timestamp: Date
): {
  channel: Channel;
  success: false;
  error: string;
  timestamp: Date;
  metadata: { skipped: true; skipReason: string };
} {
  return {
    channel,
    success: false,
    error: CHANNEL_DISABLED_REASON,
    timestamp,
    metadata: { skipped: true, skipReason: CHANNEL_DISABLED_REASON },
  };
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

const NO_DISABLED_CHANNELS: ReadonlySet<CommunicationChannel> = new Set();

/**
 * The channels (in order, without repeats) that will really be attempted for the recipient.
 * With `singleExternal`, in-app (socket) plus only the first reachable out-of-app channel whose
 * provider is enabled: a disabled provider (WHATSAPP_ENABLED=false, email off) is unavailable,
 * so the next channel carries the message instead of a send that never leaves the server.
 * Without `singleExternal` a disabled channel is still attempted and records SKIPPED.
 */
export function eligibleChannels(
  channels: readonly CommunicationChannel[],
  recipient: DeliveryPlanRecipient,
  singleExternal = false,
  disabled: ReadonlySet<CommunicationChannel> = NO_DISABLED_CHANNELS
): CommunicationChannel[] {
  const reachable = Array.from(new Set(channels)).filter(channel =>
    canChannelReach(channel, recipient)
  );
  if (!singleExternal) return reachable;
  const external = reachable.find(channel => channel !== 'socket' && !disabled.has(channel));
  return reachable.filter(channel => channel === 'socket' || channel === external);
}

/** Start state of the recipient's inbox row. */
export function initialNotificationState(
  finalChannels: readonly CommunicationChannel[],
  recipient: DeliveryPlanRecipient,
  singleExternal = false,
  disabled: ReadonlySet<CommunicationChannel> = NO_DISABLED_CHANNELS
): InitialNotificationState {
  const eligible = eligibleChannels(finalChannels, recipient, singleExternal, disabled);
  const first = eligible.find(channel => !disabled.has(channel));
  if (first) {
    return { status: 'PENDING', deliveryStatus: 'PENDING', channel: first, failureReason: null };
  }
  const reachable = eligibleChannels(finalChannels, recipient);
  if (reachable.length > 0) {
    // Every channel that could reach the recipient has its provider switched off.
    return {
      status: 'SKIPPED',
      deliveryStatus: 'SKIPPED',
      channel: reachable[0] ?? 'none',
      failureReason: CHANNEL_DISABLED_REASON,
    };
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
