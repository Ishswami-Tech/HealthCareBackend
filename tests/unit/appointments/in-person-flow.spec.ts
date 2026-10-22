/**
 * Product rules V2 - in-person stages, transitions, QR scan validation, queue place, nearest
 * location. Pure functions only (src/libs/utils/in-person-flow.util.ts).
 */
import {
  IN_PERSON_TRANSITIONS,
  InPersonTransitionError,
  assertInPersonTransition,
  canDoctorCall,
  checkInWindowState,
  computeCheckInWindow,
  computeQueuePlace,
  deriveInPersonStage,
  evaluateQrScan,
  QR_WINDOW_CLOSES_AFTER_MINUTES,
  QR_WINDOW_OPENS_BEFORE_MINUTES,
  scanFailureMessage,
  formatQueueToken,
  isInLiveQueue,
  locationTokenPrefix,
  queueTokenLabel,
  readWalkInFlag,
  parseGeoPoint,
  pickScanCandidate,
  rankLocationsByDistance,
} from '@utils/in-person-flow.util';
import {
  mayRoleBookType,
  assertReceptionMayBook,
} from '@services/appointments/core/booking-policy.util';

const LOC_A = 'loc-a';
const LOC_B = 'loc-b';
/** 2026-10-20 10:00 IST = 04:30Z */
const SLOT = { date: '2026-10-20', time: '10:00', duration: 15 };
const at = (iso: string): Date => new Date(iso);

function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    type: 'IN_PERSON',
    status: 'SCHEDULED',
    checkedInAt: null,
    locationId: LOC_A,
    ...SLOT,
    ...over,
  };
}

describe('deriveInPersonStage', () => {
  it.each([
    ['SCHEDULED', null, 'BOOKED'],
    ['PENDING', null, 'BOOKED'],
    ['CONFIRMED', null, 'BOOKED'],
    ['CONFIRMED', new Date(), 'CHECKED_IN'],
    ['IN_PROGRESS', new Date(), 'WITH_DOCTOR'],
    ['COMPLETED', new Date(), 'COMPLETED'],
    ['NO_SHOW', null, 'NO_SHOW'],
    ['EXPIRED', null, 'EXPIRED'],
    ['CANCELLED', null, 'CANCELLED'],
  ])('%s (checkedInAt=%s) -> %s', (status, checkedInAt, stage) => {
    expect(deriveInPersonStage({ status, checkedInAt })).toBe(stage);
  });

  it('has no vitals / ready-for-doctor stage', () => {
    expect(Object.keys(IN_PERSON_TRANSITIONS)).toEqual([
      'BOOKED',
      'CHECKED_IN',
      'WITH_DOCTOR',
      'COMPLETED',
      'NO_SHOW',
      'EXPIRED',
      'CANCELLED',
    ]);
  });
});

describe('status transitions', () => {
  it('Booked -> Checked in -> With doctor -> Completed', () => {
    expect(() => assertInPersonTransition('BOOKED', 'CHECKED_IN')).not.toThrow();
    expect(() => assertInPersonTransition('CHECKED_IN', 'WITH_DOCTOR')).not.toThrow();
    expect(() => assertInPersonTransition('WITH_DOCTOR', 'COMPLETED')).not.toThrow();
  });

  it('no-show / expiry from booked or checked in', () => {
    for (const from of ['BOOKED', 'CHECKED_IN'] as const) {
      expect(() => assertInPersonTransition(from, 'NO_SHOW')).not.toThrow();
      expect(() => assertInPersonTransition(from, 'EXPIRED')).not.toThrow();
    }
  });

  it.each([
    ['BOOKED', 'WITH_DOCTOR'],
    ['BOOKED', 'COMPLETED'],
    ['CHECKED_IN', 'COMPLETED'],
    ['COMPLETED', 'CHECKED_IN'],
    ['NO_SHOW', 'CHECKED_IN'],
    ['WITH_DOCTOR', 'CHECKED_IN'],
  ] as const)('refuses %s -> %s', (from, to) => {
    expect(() => assertInPersonTransition(from, to)).toThrow(InPersonTransitionError);
  });

  it('only checked-in in-person visits are in the queue / callable', () => {
    expect(isInLiveQueue({ status: 'SCHEDULED', checkedInAt: null })).toBe(false);
    expect(isInLiveQueue({ status: 'CONFIRMED', checkedInAt: null })).toBe(false);
    expect(isInLiveQueue({ status: 'CONFIRMED', checkedInAt: new Date() })).toBe(true);
    expect(isInLiveQueue({ status: 'IN_PROGRESS', checkedInAt: new Date() })).toBe(true);
    expect(
      isInLiveQueue({ type: 'VIDEO_CALL', status: 'CONFIRMED', checkedInAt: new Date() })
    ).toBe(false);
    expect(canDoctorCall({ status: 'CONFIRMED', checkedInAt: new Date() })).toBe(true);
    expect(canDoctorCall({ status: 'SCHEDULED', checkedInAt: null })).toBe(false);
    expect(canDoctorCall({ status: 'IN_PROGRESS', checkedInAt: new Date() })).toBe(false);
  });
});

describe('check-in window (20 min before .. 45 min after the slot start)', () => {
  const window = computeCheckInWindow(SLOT);

  it('is computed in IST', () => {
    expect(window?.startsAt.toISOString()).toBe('2026-10-20T04:30:00.000Z');
    expect(window?.opensAt.toISOString()).toBe('2026-10-20T04:10:00.000Z');
    expect(window?.closesAt.toISOString()).toBe('2026-10-20T05:15:00.000Z');
  });

  it('states (both edges inclusive)', () => {
    if (!window) throw new Error('window');
    expect(checkInWindowState(window, at('2026-10-20T04:09:00Z'))).toBe('TOO_EARLY');
    expect(checkInWindowState(window, at('2026-10-20T04:10:00Z'))).toBe('OPEN');
    expect(checkInWindowState(window, at('2026-10-20T05:15:00Z'))).toBe('OPEN');
    expect(checkInWindowState(window, at('2026-10-20T05:16:00Z'))).toBe('CLOSED');
  });

  it('does not depend on the visit length, and fails closed without a slot', () => {
    for (const duration of [null, 3, 15, 60]) {
      expect(computeCheckInWindow({ ...SLOT, duration })?.closesAt.toISOString()).toBe(
        '2026-10-20T05:15:00.000Z'
      );
    }
    expect(computeCheckInWindow({ date: null, time: '10:00' })).toBeNull();
    expect(computeCheckInWindow({ date: '2026-10-20', time: '' })).toBeNull();
  });

  it('pins the product rule: opens 20 min before, closes 45 min after', () => {
    expect(QR_WINDOW_OPENS_BEFORE_MINUTES).toBe(20);
    expect(QR_WINDOW_CLOSES_AFTER_MINUTES).toBe(45);
  });
});

describe('a 2:00 pm slot: QR check-in 1:40 pm .. 2:45 pm', () => {
  // 14:00 IST = 08:30Z. 3-minute visit: the window still runs to 2:45 pm.
  const twoPm = (): ReturnType<typeof booking> => booking({ time: '14:00', duration: 3 });

  it('1:39 pm is too early and names the opening time', () => {
    expect(evaluateQrScan(twoPm(), [LOC_A], at('2026-10-20T08:09:00Z'))).toEqual({
      ok: false,
      reason: 'TOO_EARLY',
      message:
        'Check-in opens at 1:40 pm, 20 minutes before your 2:00 pm appointment. Please scan again then, or ask the reception desk to check you in.',
    });
  });

  it('1:40 pm is open', () => {
    expect(evaluateQrScan(twoPm(), [LOC_A], at('2026-10-20T08:10:00Z'))).toEqual({
      ok: true,
      alreadyCheckedIn: false,
    });
  });

  it('2:45 pm is still open', () => {
    expect(evaluateQrScan(twoPm(), [LOC_A], at('2026-10-20T09:15:00Z'))).toEqual({
      ok: true,
      alreadyCheckedIn: false,
    });
  });

  it('2:46 pm is too late: the window closed at 2:45 pm, go to reception', () => {
    expect(evaluateQrScan(twoPm(), [LOC_A], at('2026-10-20T09:16:00Z'))).toEqual({
      ok: false,
      reason: 'EXPIRED',
      message:
        'The check-in window closed at 2:45 pm. If you are at the clinic, show your booking or ask the reception desk to check you in.',
    });
  });

  it('scanFailureMessage without a window falls back to the generic copy', () => {
    expect(scanFailureMessage('TOO_EARLY')).toBe(
      'Check-in opens 20 minutes before your appointment. Scan again then, or ask the reception desk to check you in.'
    );
    expect(scanFailureMessage('EXPIRED')).toBe(
      'Self check-in closes 45 minutes after your appointment time. If you are at the clinic, show your booking or ask the reception desk to check you in.'
    );
  });
});

describe('evaluateQrScan (V2 rule 3)', () => {
  const inWindow = at('2026-10-20T04:20:00Z'); // 09:50 IST

  it('accepts the booked location inside the window', () => {
    expect(evaluateQrScan(booking(), ['qr-1', LOC_A], inWindow)).toEqual({
      ok: true,
      alreadyCheckedIn: false,
    });
  });

  it('WRONG_LOCATION for another location QR', () => {
    expect(evaluateQrScan(booking(), ['qr-2', LOC_B], inWindow)).toMatchObject({
      ok: false,
      reason: 'WRONG_LOCATION',
    });
  });

  it('TOO_EARLY more than 20 min before (the old 60 min window no longer applies)', () => {
    expect(evaluateQrScan(booking(), [LOC_A], at('2026-10-20T04:09:00Z'))).toMatchObject({
      reason: 'TOO_EARLY',
      message:
        'Check-in opens at 9:40 am, 20 minutes before your 10:00 am appointment. Please scan again then, or ask the reception desk to check you in.',
    });
    expect(evaluateQrScan(booking(), [LOC_A], at('2026-10-20T03:40:00Z'))).toMatchObject({
      reason: 'TOO_EARLY',
    });
  });

  it('closes 45 min after the start whatever the visit length (a 3-minute slot too)', () => {
    const short = booking({ duration: 3 });
    expect(evaluateQrScan(short, [LOC_A], at('2026-10-20T04:34:00Z'))).toMatchObject({ ok: true });
    expect(evaluateQrScan(short, [LOC_A], at('2026-10-20T05:15:00Z'))).toMatchObject({ ok: true });
    expect(evaluateQrScan(short, [LOC_A], at('2026-10-20T05:16:00Z'))).toMatchObject({
      reason: 'EXPIRED',
    });
  });

  it('EXPIRED after the window closed, or for an expired / no-show visit', () => {
    expect(evaluateQrScan(booking(), [LOC_A], at('2026-10-20T05:30:00Z'))).toMatchObject({
      reason: 'EXPIRED',
      message:
        'The check-in window closed at 10:45 am. If you are at the clinic, show your booking or ask the reception desk to check you in.',
    });
    expect(evaluateQrScan(booking({ status: 'EXPIRED' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'EXPIRED',
    });
    expect(evaluateQrScan(booking({ status: 'NO_SHOW' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'EXPIRED',
    });
  });

  it('NOT_BOOKED without a booking or for a cancelled / completed one', () => {
    expect(evaluateQrScan(null, [LOC_A], inWindow)).toMatchObject({ reason: 'NOT_BOOKED' });
    expect(evaluateQrScan(booking({ status: 'CANCELLED' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'NOT_BOOKED',
    });
  });

  it('another day: TOO_EARLY for a future visit, EXPIRED for a past one', () => {
    expect(evaluateQrScan(booking({ date: '2026-10-21' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'TOO_EARLY',
    });
    expect(evaluateQrScan(booking({ date: '2026-10-19' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'EXPIRED',
    });
  });

  it('is idempotent for an arrival already recorded', () => {
    const checkedIn = booking({ status: 'CONFIRMED', checkedInAt: new Date() });
    expect(evaluateQrScan(checkedIn, [LOC_A], at('2026-10-20T06:00:00Z'))).toEqual({
      ok: true,
      alreadyCheckedIn: true,
    });
  });

  it('refuses video visits', () => {
    expect(evaluateQrScan(booking({ type: 'VIDEO_CALL' }), [LOC_A], inWindow)).toMatchObject({
      reason: 'VIDEO_VISIT',
    });
  });
});

describe('pickScanCandidate', () => {
  it('prefers the booking at the scanned location', () => {
    const elsewhere = booking({ id: 'b', locationId: LOC_B, time: '09:00' });
    const here = booking({ id: 'a', locationId: LOC_A, time: '11:00' });
    expect(pickScanCandidate([elsewhere, here], [LOC_A]).match?.id).toBe('a');
  });

  it('falls back to a booking elsewhere (reported as wrong location)', () => {
    const elsewhere = booking({ id: 'b', locationId: LOC_B });
    expect(pickScanCandidate([elsewhere], [LOC_A]).match?.id).toBe('b');
  });

  it('asks to choose between two open bookings at the same location', () => {
    const one = booking({ id: 'a', time: '10:00' });
    const two = booking({ id: 'b', time: '09:00' });
    const result = pickScanCandidate([one, two], [LOC_A]);
    expect(result.match).toBeNull();
    expect(result.ambiguous.map(b => b.id)).toEqual(['b', 'a']);
  });

  it('honours an explicit appointmentId and ignores terminal bookings otherwise', () => {
    const done = booking({ id: 'x', status: 'COMPLETED' });
    expect(pickScanCandidate([done], [LOC_A]).match).toBeNull();
    expect(pickScanCandidate([done], [LOC_A], 'x').match?.id).toBe('x');
  });
});

describe('queue place, token, ETA', () => {
  const queue = [
    { appointmentId: 'p1', status: 'IN_PROGRESS', tokenNumber: 11 },
    { appointmentId: 'p2', status: 'WAITING', tokenNumber: 12 },
    { appointmentId: 'p3', status: 'WAITING', tokenNumber: 13 },
    { appointmentId: 'p0', status: 'COMPLETED', tokenNumber: 10 },
  ];

  it('formats K-0xx tokens', () => {
    expect(formatQueueToken(14)).toBe('K-014');
    expect(formatQueueToken(123)).toBe('K-123');
    expect(formatQueueToken(null)).toBeNull();
    expect(formatQueueToken(0)).toBeNull();
  });

  it('next patient', () => {
    expect(computeQueuePlace(queue, 'p2', 15)).toEqual({
      position: 1,
      peopleAhead: 0,
      etaMinutes: 8,
      isNext: true,
      nowServingToken: 11,
      nowServingTokenLabel: 'K-011',
    });
  });

  it('prefers the location-prefixed label stored at check-in', () => {
    const baner = [
      {
        appointmentId: 'b1',
        status: 'IN_PROGRESS',
        tokenNumber: 1,
        tokenLabel: 'B-001',
      },
      {
        appointmentId: 'b2',
        status: 'WAITING',
        tokenNumber: 2,
        tokenLabel: 'B-002',
      },
    ];
    expect(computeQueuePlace(baner, 'b2')?.nowServingTokenLabel).toBe('B-001');
    expect(queueTokenLabel({ tokenNumber: 2, tokenLabel: 'B-002' })).toBe('B-002');
    expect(queueTokenLabel({ tokenNumber: 2 })).toBe('K-002');
    expect(queueTokenLabel(null)).toBeNull();
  });

  it('people ahead and ETA', () => {
    expect(computeQueuePlace(queue, 'p3', 15)).toMatchObject({
      position: 2,
      peopleAhead: 1,
      etaMinutes: 23,
      isNext: false,
    });
  });

  it('ETA defaults to the clinic in-person visit length (3 min), not a fixed 15', () => {
    // 1 waiting ahead x 3 + half of the consultation in progress (ceil 1.5 = 2).
    expect(computeQueuePlace(queue, 'p3')?.etaMinutes).toBe(5);
    // A clinic with 5-minute in-person visits: 1 x 5 + ceil(2.5) = 8.
    expect(computeQueuePlace(queue, 'p3', 5)?.etaMinutes).toBe(8);
  });

  it('with the doctor / not queued', () => {
    expect(computeQueuePlace(queue, 'p1')).toMatchObject({
      position: 0,
      peopleAhead: 0,
      isNext: false,
    });
    expect(computeQueuePlace(queue, 'p0')).toBeNull();
    expect(computeQueuePlace(queue, 'nobody')).toBeNull();
  });
});

describe('token series per location (prefix)', () => {
  it('takes the first letter of the location name', () => {
    expect(locationTokenPrefix({ name: 'Kothrud' })).toBe('K');
    expect(locationTokenPrefix({ name: 'baner clinic' })).toBe('B');
    expect(formatQueueToken(1, locationTokenPrefix({ name: 'Baner' }))).toBe('B-001');
  });

  it('honours ClinicLocation.settings.tokenPrefix (1-3 letters/digits), else falls back', () => {
    expect(locationTokenPrefix({ name: 'Baner', settings: { tokenPrefix: 'bn' } })).toBe('BN');
    expect(
      locationTokenPrefix({
        name: 'Baner',
        settings: { tokenPrefix: 'TOO-LONG' },
      })
    ).toBe('B');
    expect(locationTokenPrefix({ name: '' })).toBe('K');
    expect(locationTokenPrefix(null)).toBe('K');
  });

  it('reads the walk-in tag from the booking metadata', () => {
    expect(readWalkInFlag({ isWalkIn: true })).toBe(true);
    expect(readWalkInFlag({ bookingSource: 'WALK_IN' })).toBe(true);
    expect(readWalkInFlag({ bookingSource: 'APP' })).toBe(false);
    expect(readWalkInFlag(null)).toBeUndefined();
  });
});

describe('nearest location', () => {
  const locations = [
    { name: 'Wakad', latitude: 18.5975, longitude: 73.7898 },
    { name: 'Kothrud', latitude: 18.5074, longitude: 73.8077 },
    { name: 'No geo', latitude: null, longitude: null },
  ];

  it('ranks nearest first and flags it', () => {
    const ranked = rankLocationsByDistance(locations, { lat: 18.51, lng: 73.81 });
    expect(ranked.map(l => l.name)).toEqual(['Kothrud', 'Wakad', 'No geo']);
    expect(ranked[0]?.isNearest).toBe(true);
    expect(ranked[1]?.isNearest).toBe(false);
    expect(ranked[2]?.distanceMeters).toBeNull();
  });

  it('without a position: by name, nothing flagged', () => {
    const ranked = rankLocationsByDistance(locations, null);
    expect(ranked.map(l => l.name)).toEqual(['Kothrud', 'No geo', 'Wakad']);
    expect(ranked.some(l => l.isNearest)).toBe(false);
  });

  it('parses query coordinates strictly', () => {
    expect(parseGeoPoint('18.5', '73.8')).toEqual({ lat: 18.5, lng: 73.8 });
    expect(parseGeoPoint('abc', '73.8')).toBeNull();
    expect(parseGeoPoint('91', '0')).toBeNull();
    expect(parseGeoPoint(undefined, undefined)).toBeNull();
  });
});

describe('booking policy: reception never books video', () => {
  it('blocks RECEPTIONIST + VIDEO_CALL only', () => {
    expect(mayRoleBookType('RECEPTIONIST', 'VIDEO_CALL')).toBe(false);
    expect(mayRoleBookType('receptionist', 'video_call')).toBe(false);
    expect(mayRoleBookType('RECEPTIONIST', 'IN_PERSON')).toBe(true);
    expect(mayRoleBookType('PATIENT', 'VIDEO_CALL')).toBe(true);
    expect(() => assertReceptionMayBook('RECEPTIONIST', 'VIDEO_CALL')).toThrow(
      /Reception cannot book video visits/
    );
  });
});
