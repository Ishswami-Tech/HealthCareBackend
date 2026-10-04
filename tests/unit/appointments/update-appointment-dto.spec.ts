/**
 * PUT /appointments/:id request body: UpdateAppointmentDto validated the way the global
 * ValidationPipe does (transform + whitelist + forbidNonWhitelisted), then handed to the real
 * service. A notes-only update (what a patient may send) must be valid without a priority.
 */
import { describe, it, expect, jest } from '@jest/globals';
import 'reflect-metadata';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Role } from '@core/types/enums.types';
import { AppointmentPriority, UpdateAppointmentDto } from '@dtos/appointment.dto';
import { CLINIC, appointmentRow, rejection } from './appointments-harness';
import { buildRealCoreHarness } from './appointments-real-core-harness';

async function validated(plain: Record<string, unknown>) {
  const instance = plainToInstance(UpdateAppointmentDto, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return { instance, invalidFields: errors.map(error => error.property) };
}

describe('UpdateAppointmentDto', () => {
  it('a notes-only body is valid: priority is optional', async () => {
    const { invalidFields } = await validated({ notes: 'please call me' });

    expect(invalidFields).toEqual([]);
  });

  it('an empty body is valid', async () => {
    expect((await validated({})).invalidFields).toEqual([]);
  });

  it('a valid priority is still accepted by validation (who may send it is decided later)', async () => {
    expect((await validated({ priority: AppointmentPriority.HIGH })).invalidFields).toEqual([]);
  });

  it('a bad priority value is still a validation error (400)', async () => {
    expect((await validated({ notes: 'x', priority: 'SOMEDAY' })).invalidFields).toEqual([
      'priority',
    ]);
  });

  it('a field the DTO does not know is refused by the pipe (whitelist)', async () => {
    expect((await validated({ notes: 'x', followUpNotes: 'y' })).invalidFields).toEqual([
      'followUpNotes',
    ]);
  });
});

describe('PUT /appointments/:id from a patient, DTO to service', () => {
  const put = async (plain: Record<string, unknown>) => {
    const harness = buildRealCoreHarness();
    harness.db.insert('appointment', appointmentRow({ status: 'SCHEDULED', checkedInAt: null }));
    const { instance } = await validated(plain);
    const outcome = harness.service.updateAppointment(
      'appt-1',
      instance,
      'user-patient',
      CLINIC,
      Role.PATIENT
    );
    return { harness, outcome };
  };

  it('{ notes } succeeds (200) and changes only the notes', async () => {
    const { harness, outcome } = await put({ notes: 'please call me' });

    const result = await outcome;

    expect(result.success).toBe(true);
    expect(harness.db.rows('appointment')[0]?.['notes']).toBe('please call me');
    expect(harness.db.rows('appointment')[0]?.['status']).toBe('SCHEDULED');
  });

  it('{ notes, priority } is refused (400): priority is staff-only, nothing is written', async () => {
    const { harness, outcome } = await put({ notes: 'x', priority: AppointmentPriority.HIGH });

    const error = await rejection(outcome);

    expect(error.getStatus()).toBe(400);
    expect(error.message).toContain('Field "priority" cannot be changed here.');
    expect(harness.db.writes).toHaveLength(0);
  });
});
