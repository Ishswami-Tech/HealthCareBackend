import { describe, expect, it } from '@jest/globals';
import {
  isConnectionUrl,
  isSensitiveClinicKey,
  toSafeClinicResponse,
} from '../../../src/services/clinic/clinic-response.util';

/** Every key, at any depth, of a JSON-like value. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach(item => deepKeys(item, out));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      deepKeys(child, out);
    }
  }
  return out;
}

function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => deepStrings(item, out));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value as Record<string, unknown>).forEach(child => deepStrings(child, out));
  }
  return out;
}

const DSN = 'postgresql://postgres:s3cret@healthcare-postgres:5432/userdb?schema=public';

function rawClinicRow(): Record<string, unknown> {
  return {
    id: '6fd5490c-f2b2-4bde-aafa-d58f2ada5d71',
    clinicId: 'CL0002',
    name: 'Aadesh Ayurvedalay',
    email: 'clinic@example.com',
    db_connection_string: DSN,
    databaseName: 'clinic_cl0002',
    databaseStatus: 'ACTIVE',
    databaseCreatedAt: new Date('2026-01-01T00:00:00Z'),
    databaseLastSync: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    settings: {
      appointmentSettings: { videoDurationMinutes: 15 },
      communication: {
        whatsapp: { apiKey: 'wa-key', phoneNumberId: '123', accessToken: 'tok' },
        smtp: { host: 'smtp.example.com', smtpPassword: 'pw', password: 'pw2' },
      },
      payments: { cashfree: { clientSecret: 'cs', secretKey: 'sk', appId: 'app-1' } },
      replicaUrl: 'postgres://ro:pw@replica:5432/userdb',
    },
    locations: [
      {
        id: 'loc-1',
        name: 'Main',
        workingHours: { mon: '09:00-17:00' },
        credentials: { user: 'x' },
      },
    ],
  };
}

describe('toSafeClinicResponse (B18)', () => {
  it('never returns connection strings, database internals or secrets at any depth', () => {
    const safe = toSafeClinicResponse(rawClinicRow());
    const keys = deepKeys(safe);
    for (const forbidden of [
      'db_connection_string',
      'databaseName',
      'databaseStatus',
      'databaseCreatedAt',
      'databaseLastSync',
      'apiKey',
      'accessToken',
      'smtpPassword',
      'password',
      'clientSecret',
      'secretKey',
      'credentials',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    for (const value of deepStrings(safe)) {
      expect(value).not.toMatch(/^(postgres(ql)?|redis|mysql):\/\//);
      expect(value).not.toContain('s3cret');
    }
  });

  it('keeps the public clinic fields, dates and non-secret settings', () => {
    const safe = toSafeClinicResponse(rawClinicRow()) as Record<string, unknown>;
    expect(safe['clinicId']).toBe('CL0002');
    expect(safe['name']).toBe('Aadesh Ayurvedalay');
    expect(safe['createdAt']).toEqual(new Date('2026-01-01T00:00:00Z'));
    const settings = safe['settings'] as Record<string, Record<string, unknown>>;
    expect(settings['appointmentSettings']).toEqual({ videoDurationMinutes: 15 });
    expect(settings['payments']).toEqual({ cashfree: { appId: 'app-1' } });
    expect(
      (settings['communication'] as Record<string, Record<string, unknown>>)['whatsapp']
    ).toEqual({ phoneNumberId: '123' });
    expect((safe['locations'] as Array<Record<string, unknown>>)[0]).toEqual({
      id: 'loc-1',
      name: 'Main',
      workingHours: { mon: '09:00-17:00' },
    });
  });

  it('shapes arrays of clinics and never mutates the input', () => {
    const row = rawClinicRow();
    const [safe] = toSafeClinicResponse([row]) as Array<Record<string, unknown>>;
    expect(safe).toBeDefined();
    expect(safe?.['db_connection_string']).toBeUndefined();
    expect(row['db_connection_string']).toBe(DSN);
  });

  it('returns a location workingHours JSON string as the parsed object', () => {
    const safe = toSafeClinicResponse({
      locations: [
        { id: 'a', workingHours: '{"start":"00:00","end":"23:59"}' },
        { id: 'b', workingHours: 'Mon-Fri 9-5' },
      ],
    }) as { locations: Array<Record<string, unknown>> };
    expect(safe.locations[0]?.['workingHours']).toEqual({ start: '00:00', end: '23:59' });
    expect(safe.locations[1]?.['workingHours']).toBe('Mon-Fri 9-5');
  });

  it('keeps class instances (Prisma Decimal and friends) as they are', () => {
    class Decimalish {
      constructor(readonly value: string) {}
      toJSON(): string {
        return this.value;
      }
    }
    const price = new Decimalish('10.50');
    const safe = toSafeClinicResponse({ price }) as { price: unknown };
    expect(safe.price).toBe(price);
  });
});

describe('isSensitiveClinicKey', () => {
  it('matches secret-bearing keys in any case style', () => {
    for (const key of ['db_connection_string', 'DATABASE_URL', 'webhook-secret', 'smtpPassword']) {
      expect(isSensitiveClinicKey(key)).toBe(true);
    }
  });

  it('leaves ordinary keys alone', () => {
    for (const key of ['name', 'email', 'tokenNumber', 'subdomain', 'timezone', 'secretary']) {
      expect(isSensitiveClinicKey(key)).toBe(false);
    }
  });

  it('recognises connection URLs', () => {
    expect(isConnectionUrl(DSN)).toBe(true);
    expect(isConnectionUrl('rediss://cache:6379')).toBe(true);
    expect(isConnectionUrl('https://clinic.example.com')).toBe(false);
  });
});
