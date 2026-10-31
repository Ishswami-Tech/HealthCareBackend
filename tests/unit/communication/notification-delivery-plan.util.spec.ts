import { describe, expect, it } from '@jest/globals';
import {
  canChannelReach,
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
