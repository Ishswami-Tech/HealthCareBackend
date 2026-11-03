import { describe, expect, it } from '@jest/globals';
import {
  SAFE_APPOINTMENT_PEOPLE_INCLUDE,
  SAFE_APPOINTMENT_USER_SELECT,
  findCredentialKeyPaths,
  redactAppointmentResponse,
  stripCredentialFields,
  toSafeAppointmentUsers,
} from '@services/appointments/core/appointment-response-redaction.util';

/** Generic deep check: no `password`-like key anywhere in a response. */
function expectNoCredentials(value: unknown): void {
  expect(findCredentialKeyPaths(value)).toEqual([]);
  expect(JSON.stringify(value)).not.toMatch(/"password"/i);
}

const fullUser = (id: string): Record<string, unknown> => ({
  id,
  userid: `U-${id}`,
  name: `Name ${id}`,
  firstName: 'First',
  lastName: 'Last',
  phone: '+919999999999',
  email: `${id}@example.test`,
  profilePicture: null,
  password: '$2b$10$abcdefghijklmnopqrstuv',
  passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
  googleId: 'g-1',
  lastLoginIP: '10.0.0.1',
  role: 'DOCTOR',
  medicalConditions: 'secret condition',
});

const appointmentRow = (): Record<string, unknown> => ({
  id: 'apt-1',
  clinicId: 'clinic-1',
  status: 'SCHEDULED',
  date: new Date('2026-10-22T18:30:00Z'),
  patient: { id: 'pat-1', userId: 'u-pat', user: fullUser('u-pat'), allergies: 'peanuts' },
  doctor: { id: 'doc-1', userId: 'u-doc', user: fullUser('u-doc') },
  user: fullUser('u-pat'),
  diagnosis: 'flu',
});

describe('appointment response redaction (C1)', () => {
  it('the appointment queries select only safe user columns (no password)', () => {
    expect(Object.keys(SAFE_APPOINTMENT_USER_SELECT).sort()).toEqual(
      ['email', 'firstName', 'id', 'lastName', 'name', 'phone', 'profilePicture'].sort()
    );
    expect(SAFE_APPOINTMENT_PEOPLE_INCLUDE.patient.include.user.select).toBe(
      SAFE_APPOINTMENT_USER_SELECT
    );
    expect(SAFE_APPOINTMENT_PEOPLE_INCLUDE.doctor.include.user.select).toBe(
      SAFE_APPOINTMENT_USER_SELECT
    );
  });

  it('toSafeAppointmentUsers keeps only the safe columns of patient / doctor / user', () => {
    const safe = toSafeAppointmentUsers(appointmentRow());
    expectNoCredentials(safe);
    const doctorUser = (safe['doctor'] as Record<string, unknown>)['user'] as Record<
      string,
      unknown
    >;
    expect(doctorUser).toEqual({
      id: 'u-doc',
      name: 'Name u-doc',
      firstName: 'First',
      lastName: 'Last',
      phone: '+919999999999',
      email: 'u-doc@example.test',
      profilePicture: null,
    });
    // The rest of the row is untouched (Dates stay Dates for internal callers).
    expect(safe['date']).toBeInstanceOf(Date);
    expect(safe['diagnosis']).toBe('flu');
  });

  it('strips credentials at any depth, in lists and wrapped responses, for every role', () => {
    const response = {
      success: true,
      data: { appointments: [appointmentRow(), appointmentRow()], meta: { total: 2 } },
    };
    for (const role of ['PATIENT', 'DOCTOR', 'CLINIC_ADMIN', 'SUPER_ADMIN', undefined]) {
      const out = redactAppointmentResponse(response, role);
      expectNoCredentials(out);
      expect((out.data.appointments[0] as Record<string, unknown>)['diagnosis']).toBe('flu');
    }
    // The input is never mutated.
    expect(findCredentialKeyPaths(response).length).toBeGreaterThan(0);
  });

  it('the reception desk also loses the clinical keys (contract 18.8)', () => {
    const out = redactAppointmentResponse({ data: appointmentRow() }, 'RECEPTIONIST');
    expectNoCredentials(out);
    expect(out.data['diagnosis']).toBeUndefined();
    expect((out.data['patient'] as Record<string, unknown>)['allergies']).toBeUndefined();
    expect((out.data['patient'] as Record<string, unknown>)['id']).toBe('pat-1');
  });

  it('keeps ordinary keys that only look similar', () => {
    const out = stripCredentialFields({
      passwordPolicy: 'x',
      token: 'K-001',
      tokenLabel: 'K-001',
      notes: 'n',
    });
    expect(out).toEqual({ passwordPolicy: 'x', token: 'K-001', tokenLabel: 'K-001', notes: 'n' });
  });

  const ROLES = ['PATIENT', 'DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN', 'SUPER_ADMIN', undefined];

  it('keeps the queue display token at the top level and in visit data, for every role', () => {
    const response = {
      success: true,
      data: {
        ...appointmentRow(),
        token: 'K-014',
        tokenNumber: 14,
        tokenLabel: 'K-014',
        visit: { appointmentId: 'apt-1', token: 'K-014', tokenNumber: 14, status: 'WAITING' },
        appointments: [{ id: 'apt-2', token: 'K-015', tokenLabel: 'K-015' }],
      },
    };
    for (const role of ROLES) {
      const out = redactAppointmentResponse(response, role);
      expect(out.data.token).toBe('K-014');
      expect(out.data.tokenLabel).toBe('K-014');
      expect(out.data.visit.token).toBe('K-014');
      expect(out.data.appointments[0]?.token).toBe('K-015');
    }
  });

  it('still removes provider secrets inside the embedded clinic row and settings objects', () => {
    const response = {
      data: {
        id: 'apt-1',
        token: 'K-001',
        clinic: {
          id: 'clinic-1',
          name: 'Kothrud Clinic',
          db_connection_string: 'postgresql://u:p@db:5432/x',
          databaseName: 'clinic_db',
          settings: {
            whatsapp: { phoneNumberId: '123', token: 'wa-provider-token', apiKey: 'k' },
            payment: { cashfreeSecretKey: 's', mode: 'TEST' },
          },
        },
        location: {
          id: 'loc-1',
          name: 'Kothrud',
          settings: { tokenPrefix: 'K', sms: { token: 'sms-provider-token' } },
        },
      },
    };
    for (const role of ROLES) {
      const out = redactAppointmentResponse(response, role);
      const json = JSON.stringify(out);
      expect(json).not.toContain('wa-provider-token');
      expect(json).not.toContain('sms-provider-token');
      expect(json).not.toContain('postgresql://');
      expect(out.data.clinic.name).toBe('Kothrud Clinic');
      expect(out.data.clinic.settings.whatsapp).toEqual({ phoneNumberId: '123' });
      expect(out.data.clinic.settings.payment).toEqual({ mode: 'TEST' });
      expect(out.data.location.settings.tokenPrefix).toBe('K');
      // the visit's own queue token next to the clinic row is kept
      expect(out.data.token).toBe('K-001');
    }
  });

  it('access / refresh / session tokens never leak, at any depth', () => {
    const response = {
      accessToken: 'jwt-a',
      refreshToken: 'jwt-r',
      data: {
        token: 'K-002',
        session: { sessionToken: 'secret-sess-value', access_token: 'jwt-b', id_token: 'oidc' },
        patient: { user: { authToken: 'secret-auth-value', refresh_token: 'jwt-c' } },
      },
    };
    for (const role of ROLES) {
      const json = JSON.stringify(redactAppointmentResponse(response, role));
      for (const secret of [
        'jwt-a',
        'jwt-r',
        'jwt-b',
        'jwt-c',
        'secret-sess-value',
        'oidc',
        'secret-auth-value',
      ]) {
        expect(json).not.toContain(secret);
      }
      expect(json).toContain('"token":"K-002"');
    }
  });

  it('findCredentialKeyPaths reports where a leak is', () => {
    expect(findCredentialKeyPaths({ a: [{ user: { password: 'x' } }] })).toEqual([
      '$.a[0].user.password',
    ]);
  });
});
