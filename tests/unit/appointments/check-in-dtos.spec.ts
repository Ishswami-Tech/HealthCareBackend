/**
 * Request DTOs of the check-in routes, validated the way the controller's ValidationPipe does
 * (transform + whitelist + forbidNonWhitelisted).
 */
import { describe, it, expect } from '@jest/globals';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCheckInLocationRequestDto,
  ForceCheckInDto,
  ScanLocationQRDto,
  UpdateCheckInLocationRequestDto,
} from '@dtos/appointment.dto';

async function errorsFor<T extends object>(
  type: new () => T,
  plain: Record<string, unknown>
): Promise<string[]> {
  const instance = plainToInstance(type, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map(error => error.property);
}

describe('ForceCheckInDto', () => {
  it('needs only a reason: staff send no coordinates and no location', async () => {
    expect(await errorsFor(ForceCheckInDto, { reason: 'Kiosk down' })).toEqual([]);
  });

  it('rejects a missing or empty reason', async () => {
    expect(await errorsFor(ForceCheckInDto, {})).toContain('reason');
    expect(await errorsFor(ForceCheckInDto, { reason: '' })).toContain('reason');
  });

  it('does not reject malformed coordinates: the service answers them with the one fixed 403', async () => {
    for (const coordinates of ['abc', { lat: 'x', lng: 'y' }, { lat: 999, lng: 999 }, {}]) {
      expect(await errorsFor(ForceCheckInDto, { reason: 'r', coordinates })).toEqual([]);
    }
  });

  it('accepts a staff-repeated location id but rejects a non-UUID one and unknown fields', async () => {
    expect(
      await errorsFor(ForceCheckInDto, {
        reason: 'r',
        locationId: 'f1b1c3a0-0000-4000-8000-000000000002',
      })
    ).toEqual([]);
    expect(await errorsFor(ForceCheckInDto, { reason: 'r', locationId: 'not-a-uuid' })).toContain(
      'locationId'
    );
    expect(await errorsFor(ForceCheckInDto, { reason: 'r', isAdmin: true })).toContain('isAdmin');
  });
});

describe('ScanLocationQRDto coordinates', () => {
  it('does not validate coordinates itself: the service rejects them for patients and ignores them for staff', async () => {
    for (const coordinates of [{ lat: 'abc', lng: 'def' }, { lat: 91, lng: 0 }, { lat: 10 }]) {
      expect(await errorsFor(ScanLocationQRDto, { qrCode: 'CHK-1', coordinates })).toEqual([]);
    }
  });

  it('accepts finite in-range coordinates and none at all', async () => {
    expect(
      await errorsFor(ScanLocationQRDto, {
        qrCode: 'CHK-1',
        coordinates: { lat: 19.07, lng: 72.87 },
      })
    ).toEqual([]);
    expect(await errorsFor(ScanLocationQRDto, { qrCode: 'CHK-1' })).toEqual([]);
  });
});

describe('CreateCheckInLocationRequestDto', () => {
  const valid = {
    locationName: 'Main Reception',
    coordinates: { lat: 19.076, lng: 72.8777 },
    radius: 50,
  };

  it('accepts a complete body, with or without a linked ClinicLocation', async () => {
    expect(await errorsFor(CreateCheckInLocationRequestDto, valid)).toEqual([]);
    expect(
      await errorsFor(CreateCheckInLocationRequestDto, {
        ...valid,
        locationId: 'f1b1c3a0-0000-4000-8000-000000000002',
      })
    ).toEqual([]);
  });

  it('rejects a non-UUID locationId, bad coordinates and bad radii', async () => {
    expect(
      await errorsFor(CreateCheckInLocationRequestDto, { ...valid, locationId: 'x' })
    ).toContain('locationId');
    expect(
      await errorsFor(CreateCheckInLocationRequestDto, {
        ...valid,
        coordinates: { lat: 'a', lng: 1 },
      })
    ).toContain('coordinates');
    for (const radius of [0, -1, 5001, Number.NaN, '50']) {
      expect(await errorsFor(CreateCheckInLocationRequestDto, { ...valid, radius })).toContain(
        'radius'
      );
    }
  });

  it('requires a name', async () => {
    expect(
      await errorsFor(CreateCheckInLocationRequestDto, { ...valid, locationName: '' })
    ).toContain('locationName');
  });
});

describe('UpdateCheckInLocationRequestDto', () => {
  it('accepts partial updates and rejects invalid fields', async () => {
    expect(await errorsFor(UpdateCheckInLocationRequestDto, { isActive: false })).toEqual([]);
    expect(await errorsFor(UpdateCheckInLocationRequestDto, { radius: 0 })).toContain('radius');
    expect(
      await errorsFor(UpdateCheckInLocationRequestDto, { coordinates: { lat: 200, lng: 0 } })
    ).toContain('coordinates');
  });
});
