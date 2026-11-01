import { describe, expect, it } from '@jest/globals';
import type { CommunicationChannel } from '../../../src/libs/core/types/communication.types';
import {
  CHANNEL_DISABLED_REASON,
  canChannelReach,
  channelDisabledResult,
  channelOutcome,
  eligibleChannels,
  initialNotificationState,
} from '../../../src/libs/communication/services/notification-delivery-plan.util';
import {
  MilestoneDedup,
  medicineDeskMilestone,
  medicineDeskMilestoneContent,
} from '../../../src/libs/communication/listeners/medicine-desk-notification.util';

describe('canChannelReach / eligibleChannels', () => {
  it('needs an email for email and a phone for WhatsApp/SMS', () => {
    expect(canChannelReach('email', { userId: 'u1' })).toBe(false);
    expect(canChannelReach('whatsapp', { userId: 'u1' })).toBe(false);
    expect(canChannelReach('whatsapp', { phoneNumber: '+919000000001' })).toBe(true);
    expect(canChannelReach('socket', { userId: 'u1' })).toBe(true);
    expect(canChannelReach('push', { userId: 'u1' })).toBe(true);
  });

  it('keeps order and drops repeats', () => {
    expect(eligibleChannels(['socket', 'email', 'socket', 'push'], { userId: 'u1' })).toEqual([
      'socket',
      'push',
    ]);
  });

  it('with singleExternal keeps in-app plus only the first reachable out-of-app channel', () => {
    const recipient = { userId: 'u1', email: 'a@example.test', phoneNumber: '+919000000001' };
    expect(eligibleChannels(['socket', 'push', 'whatsapp', 'email'], recipient, true)).toEqual([
      'socket',
      'push',
    ]);
    expect(
      eligibleChannels(['socket', 'whatsapp', 'email'], { email: 'a@example.test' }, true)
    ).toEqual(['email']);
  });
});

describe('initialNotificationState', () => {
  it('starts PENDING on the first channel that will really be attempted', () => {
    expect(initialNotificationState(['email', 'socket'], { userId: 'u1' })).toEqual({
      status: 'PENDING',
      deliveryStatus: 'PENDING',
      channel: 'socket',
      failureReason: null,
    });
  });

  it('is SKIPPED with a reason when no channel can reach the recipient (INT-03)', () => {
    const state = initialNotificationState(['email', 'whatsapp'], { userId: 'u1' });
    expect(state.status).toBe('SKIPPED');
    expect(state.deliveryStatus).toBe('SKIPPED');
    expect(state.failureReason).toBe('No contact for email, whatsapp');
  });

  it('is SKIPPED when preferences left no channel', () => {
    const state = initialNotificationState([], { userId: 'u1' });
    expect(state.status).toBe('SKIPPED');
    expect(state.channel).toBe('none');
  });
});

describe('disabled channel providers', () => {
  const recipient = { userId: 'u1', email: 'a@example.test', phoneNumber: '+919000000991' };
  const whatsappOff: ReadonlySet<CommunicationChannel> = new Set<CommunicationChannel>([
    'whatsapp',
  ]);

  it('a disabled provider is never the single out-of-app channel: the next one carries it', () => {
    expect(eligibleChannels(['socket', 'whatsapp', 'email'], recipient, true, whatsappOff)).toEqual(
      ['socket', 'email']
    );
    expect(
      eligibleChannels(
        ['whatsapp', 'email'],
        recipient,
        true,
        new Set<CommunicationChannel>(['whatsapp', 'email'])
      )
    ).toEqual([]);
  });

  it('without singleExternal a disabled channel is still attempted (it records SKIPPED)', () => {
    expect(eligibleChannels(['whatsapp', 'email'], recipient, false, whatsappOff)).toEqual([
      'whatsapp',
      'email',
    ]);
  });

  it('the inbox row starts on an enabled channel, or SKIPPED "channel disabled"', () => {
    expect(initialNotificationState(['whatsapp', 'email'], recipient, false, whatsappOff)).toEqual({
      status: 'PENDING',
      deliveryStatus: 'PENDING',
      channel: 'email',
      failureReason: null,
    });
    expect(initialNotificationState(['whatsapp'], recipient, true, whatsappOff)).toEqual({
      status: 'SKIPPED',
      deliveryStatus: 'SKIPPED',
      channel: 'whatsapp',
      failureReason: CHANNEL_DISABLED_REASON,
    });
  });
});

describe('channelOutcome', () => {
  it('success is SENT, a plain failure FAILED with its error', () => {
    expect(channelOutcome({ success: true })).toEqual({ status: 'SENT', reason: null });
    expect(channelOutcome({ success: false, error: 'provider 500' })).toEqual({
      status: 'FAILED',
      reason: 'provider 500',
    });
    expect(channelOutcome({ success: false })).toEqual({
      status: 'FAILED',
      reason: 'Unknown error',
    });
  });

  it('metadata.skipped is SKIPPED with skipReason (disabled provider, no registered device)', () => {
    const disabled = channelDisabledResult('whatsapp', new Date(0));
    expect(disabled.success).toBe(false);
    expect(channelOutcome(disabled)).toEqual({ status: 'SKIPPED', reason: 'channel disabled' });
    expect(
      channelOutcome({
        success: false,
        error: 'no registered device',
        metadata: { skipped: true, skipReason: 'no registered device' },
      })
    ).toEqual({ status: 'SKIPPED', reason: 'no registered device' });
  });
});

describe('medicine desk milestones', () => {
  it('notifies only when medicines were dispensed', () => {
    expect(medicineDeskMilestone('DISPENSED')).toBe('READY_TO_COLLECT');
    expect(medicineDeskMilestone('partially_dispensed')).toBe('PARTLY_READY_TO_COLLECT');
    for (const minor of ['CREATED', 'UPDATED', 'PAYMENT_UPDATED', 'CANCELLED', '', undefined]) {
      expect(medicineDeskMilestone(minor)).toBeNull();
    }
  });

  it('says the medicines are ready to collect', () => {
    expect(medicineDeskMilestoneContent('READY_TO_COLLECT').body).toContain('ready');
  });

  it('sends a milestone once per prescription within the window', () => {
    const dedup = new MilestoneDedup(60_000);
    expect(dedup.firstTime('rx-1:READY_TO_COLLECT', 0)).toBe(true);
    expect(dedup.firstTime('rx-1:READY_TO_COLLECT', 30_000)).toBe(false);
    expect(dedup.firstTime('rx-2:READY_TO_COLLECT', 30_000)).toBe(true);
    expect(dedup.firstTime('rx-1:READY_TO_COLLECT', 61_000)).toBe(true);
  });

  it('stays bounded', () => {
    const dedup = new MilestoneDedup(60_000, 2);
    expect(dedup.firstTime('a', 0)).toBe(true);
    expect(dedup.firstTime('b', 0)).toBe(true);
    expect(dedup.firstTime('c', 0)).toBe(true);
    expect(dedup.firstTime('a', 1)).toBe(true);
  });
});
