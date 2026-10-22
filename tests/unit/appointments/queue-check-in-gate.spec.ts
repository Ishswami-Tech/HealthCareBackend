/**
 * The doctor's "must be checked in" gate and the live-queue listing rule
 * (src/libs/utils/in-person-flow.util.ts): in-person visits only; legacy CONFIRMED rows queued by
 * the old flow keep working. Plus who may move a queue entry to IN_PROGRESS / COMPLETED.
 */
import { describe, it, expect } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import {
  canStartInPersonVisit,
  isListableQueueRow,
  requiresInPersonCheckIn,
} from '@utils/in-person-flow.util';
import {
  assertQueueStatusAllowed,
  canControlVisit,
  queueStatusNeedsVisitControl,
} from '@core/rbac/visit-authority.util';

describe('requiresInPersonCheckIn', () => {
  it('gates IN_PERSON (and legacy rows without a type) only', () => {
    expect(requiresInPersonCheckIn('IN_PERSON')).toBe(true);
    expect(requiresInPersonCheckIn(null)).toBe(true);
    expect(requiresInPersonCheckIn('VIDEO_CALL')).toBe(false);
    expect(requiresInPersonCheckIn('HOME_VISIT')).toBe(false);
  });
});

describe('canStartInPersonVisit', () => {
  it('video / other types are never 409 NOT_CHECKED_IN', () => {
    expect(canStartInPersonVisit({ type: 'VIDEO_CALL', status: 'CONFIRMED' }, false)).toBe(true);
    expect(canStartInPersonVisit({ type: 'HOME_VISIT', status: 'SCHEDULED' }, false)).toBe(true);
  });

  it('in-person: checked in or already with the doctor', () => {
    const checkedInAt = new Date();
    expect(
      canStartInPersonVisit({ type: 'IN_PERSON', status: 'CONFIRMED', checkedInAt }, false)
    ).toBe(true);
    expect(canStartInPersonVisit({ type: 'IN_PERSON', status: 'IN_PROGRESS' }, false)).toBe(true);
    expect(canStartInPersonVisit({ type: 'IN_PERSON', status: 'SCHEDULED' }, true)).toBe(false);
  });

  it('legacy CONFIRMED without checkedInAt counts only when it sits in the live queue', () => {
    expect(canStartInPersonVisit({ type: 'IN_PERSON', status: 'CONFIRMED' }, true)).toBe(true);
    expect(canStartInPersonVisit({ type: 'IN_PERSON', status: 'CONFIRMED' }, false)).toBe(false);
  });
});

describe('isListableQueueRow (rows already in the live queue)', () => {
  it('hides only pre-arrival in-person rows', () => {
    expect(isListableQueueRow({ type: 'IN_PERSON', status: 'SCHEDULED' })).toBe(false);
    expect(isListableQueueRow({ type: 'IN_PERSON', status: 'PENDING' })).toBe(false);
  });

  it('keeps video, in-progress, finished, checked-in and legacy CONFIRMED rows', () => {
    expect(isListableQueueRow({ type: 'VIDEO_CALL', status: 'SCHEDULED' })).toBe(true);
    expect(isListableQueueRow({ type: 'IN_PERSON', status: 'IN_PROGRESS' })).toBe(true);
    expect(isListableQueueRow({ type: 'IN_PERSON', status: 'COMPLETED' })).toBe(true);
    expect(
      isListableQueueRow({ type: 'IN_PERSON', status: 'CONFIRMED', checkedInAt: new Date() })
    ).toBe(true);
    expect(isListableQueueRow({ type: 'IN_PERSON', status: 'CONFIRMED' })).toBe(true);
  });
});

describe('queue status visit control', () => {
  it('therapist / counselor may start the sessions they may complete', () => {
    expect(canControlVisit('THERAPIST')).toBe(true);
    expect(canControlVisit('COUNSELOR')).toBe(true);
    expect(canControlVisit('ASSISTANT_DOCTOR')).toBe(false);
  });

  it('only IN_PROGRESS / COMPLETED need visit control', () => {
    expect(queueStatusNeedsVisitControl('in_progress')).toBe(true);
    expect(queueStatusNeedsVisitControl('COMPLETED')).toBe(true);
    for (const status of ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'WAITING']) {
      expect(queueStatusNeedsVisitControl(status)).toBe(false);
      expect(() => assertQueueStatusAllowed('NURSE', status)).not.toThrow();
      expect(() => assertQueueStatusAllowed('CLINIC_ADMIN', status)).not.toThrow();
    }
  });

  it('nurse / clinic admin / reception get an explicit 403 on start / complete', () => {
    for (const role of ['NURSE', 'CLINIC_ADMIN', 'RECEPTIONIST', 'ASSISTANT_DOCTOR']) {
      expect(() => assertQueueStatusAllowed(role, 'IN_PROGRESS')).toThrow(ForbiddenException);
      expect(() => assertQueueStatusAllowed(role, 'COMPLETED')).toThrow(/reserved for the doctor/);
    }
    expect(() => assertQueueStatusAllowed('DOCTOR', 'IN_PROGRESS')).not.toThrow();
    expect(() => assertQueueStatusAllowed('THERAPIST', 'COMPLETED')).not.toThrow();
  });
});
