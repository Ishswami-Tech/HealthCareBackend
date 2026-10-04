/**
 * What a client actually receives for the patient presence rejection: the global exception
 * filter must keep the exact message and the machine-readable code, also in production.
 */
import { describe, it, expect, jest } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });

import { HttpExceptionFilter } from '@core/filters/http-exception.filter';
import {
  OUTSIDE_CLINIC_RADIUS_CODE,
  OUTSIDE_CLINIC_RADIUS_MESSAGE,
  createOutsideClinicRadiusException,
} from '@services/appointments/core/check-in-presence.util';

function send(isProduction: boolean): { status: number; body: Record<string, unknown> } {
  const filter = new HttpExceptionFilter(
    { log: jest.fn(async (..._args: unknown[]) => undefined) } as never,
    { isProduction: () => isProduction } as never
  );

  let sentStatus = 0;
  let sentBody: Record<string, unknown> = {};
  const response = {
    status: (code: number) => {
      sentStatus = code;
      return { send: (body: Record<string, unknown>) => (sentBody = body) };
    },
  };
  const request = {
    url: '/api/v1/appointments/appt-1/force-check-in',
    method: 'POST',
    headers: {},
    body: {},
    user: { sub: 'user-1', role: 'PATIENT' },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  };

  filter.catch(createOutsideClinicRadiusException(), host as never);
  return { status: sentStatus, body: sentBody };
}

describe('OUTSIDE_CLINIC_RADIUS response', () => {
  it.each([false, true])(
    'is a 403 with the exact message and code (production=%s), not a generic 403',
    isProduction => {
      const { status, body } = send(isProduction);

      expect(status).toBe(403);
      expect(body['message']).toBe(OUTSIDE_CLINIC_RADIUS_MESSAGE);
      expect(body['code']).toBe(OUTSIDE_CLINIC_RADIUS_CODE);
      expect(body['message']).toBe(
        'Please scan the QR code at the clinic location. You need to be within 200 meters of the clinic to check in.'
      );
    }
  );
});
