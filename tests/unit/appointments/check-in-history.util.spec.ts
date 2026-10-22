import { describe, expect, it } from '@jest/globals';
import {
  latestAttemptByAppointment,
  readCachedJson,
  resolveCheckInMethod,
} from '@services/appointments/plugins/checkin/check-in-history.util';

describe('check-in history: method of a row', () => {
  it('uses the logged attempt method first (the in-person flow writes no notes)', () => {
    expect(resolveCheckInMethod({ attemptMethod: 'QR', actorRole: 'PATIENT', notes: null })).toBe(
      'QR'
    );
    expect(resolveCheckInMethod({ attemptMethod: 'WALK_IN', actorRole: 'RECEPTIONIST' })).toBe(
      'WALK_IN'
    );
    expect(resolveCheckInMethod({ attemptMethod: 'manual', actorRole: 'RECEPTIONIST' })).toBe(
      'MANUAL'
    );
    expect(resolveCheckInMethod({ attemptMethod: 'desk-code' })).toBe('DESK_CODE');
    expect(resolveCheckInMethod({ attemptMethod: 'STAFF' })).toBe('STAFF');
    expect(resolveCheckInMethod({ attemptMethod: 'qr_scan' })).toBe('QR');
  });

  it('falls back to the older notes, then the actor role, then the device context', () => {
    expect(resolveCheckInMethod({ notes: 'QR check-in at Kothrud' })).toBe('QR');
    expect(resolveCheckInMethod({ notes: 'Walk-in at the reception desk' })).toBe('WALK_IN');
    expect(resolveCheckInMethod({ actorRole: 'PATIENT' })).toBe('QR');
    expect(resolveCheckInMethod({ actorRole: 'RECEPTIONIST' })).toBe('MANUAL');
    expect(resolveCheckInMethod({ hasDeviceContext: true })).toBe('QR');
    expect(resolveCheckInMethod({})).toBe('MANUAL');
  });

  it('an unknown attempt method does not hide a better source', () => {
    expect(resolveCheckInMethod({ attemptMethod: 'something', actorRole: 'PATIENT' })).toBe('QR');
  });

  it('keeps the latest successful attempt per appointment', () => {
    const latest = latestAttemptByAppointment([
      {
        appointmentId: 'a1',
        method: 'QR',
        actorRole: 'PATIENT',
        createdAt: '2026-10-22T04:00:00Z',
      },
      {
        appointmentId: 'a1',
        method: 'MANUAL',
        actorRole: 'RECEPTIONIST',
        createdAt: '2026-10-22T05:00:00Z',
      },
      {
        appointmentId: null,
        method: 'QR',
        actorRole: 'PATIENT',
        createdAt: '2026-10-22T06:00:00Z',
      },
      {
        appointmentId: 'a2',
        method: 'WALK_IN',
        actorRole: 'RECEPTIONIST',
        createdAt: new Date('2026-10-22T03:00:00Z'),
      },
    ]);
    expect(latest.size).toBe(2);
    expect(latest.get('a1')?.method).toBe('MANUAL');
    expect(latest.get('a2')?.method).toBe('WALK_IN');
  });
});

describe('check-in history: cached value', () => {
  const value = { appointments: [], clinicId: 'c1', total: 0, retrievedAt: 'now' };

  it('parses a JSON string and passes an already parsed object through', () => {
    expect(readCachedJson<typeof value>(JSON.stringify(value))).toEqual(value);
    expect(readCachedJson<typeof value>(value)).toBe(value);
  });

  it('treats empty, unparseable and non-object values as a miss', () => {
    expect(readCachedJson(null)).toBeNull();
    expect(readCachedJson(undefined)).toBeNull();
    expect(readCachedJson('')).toBeNull();
    expect(readCachedJson('{not json')).toBeNull();
    expect(readCachedJson('42')).toBeNull();
  });
});
