import { describe, expect, it } from '@jest/globals';
import {
  isCriticalDomainEvent,
  liftEnvelopeFields,
  resolveEventRateLimitKey,
} from '../../../src/libs/infrastructure/events/event-envelope.util';

describe('liftEnvelopeFields', () => {
  it('lifts clinicId/userId and routing ids from a simple emit payload', () => {
    expect(
      liftEnvelopeFields({
        appointmentId: 'apt-1',
        clinicId: 'CL1',
        doctorId: 'doc-1',
        patientId: 'pat-1',
        context: { userId: 'u-rec' },
      })
    ).toEqual({
      clinicId: 'CL1',
      userId: 'u-rec',
      metadata: { appointmentId: 'apt-1', patientId: 'pat-1', doctorId: 'doc-1' },
    });
  });

  it('falls back to the nested appointment (check-in payloads)', () => {
    expect(
      liftEnvelopeFields({
        checkedInBy: 'u-rec',
        appointment: { id: 'apt-2', clinicId: 'CL2', locationId: 'loc-2' },
      })
    ).toEqual({
      clinicId: 'CL2',
      metadata: { locationId: 'loc-2', appointmentId: 'apt-2' },
    });
  });

  it('returns nothing for non-object payloads', () => {
    expect(liftEnvelopeFields(undefined)).toEqual({});
    expect(liftEnvelopeFields('x')).toEqual({});
    expect(liftEnvelopeFields([{ clinicId: 'CL1' }])).toEqual({});
  });
});

describe('emission throttling policy', () => {
  it('never treats money / appointment events as droppable', () => {
    expect(isCriticalDomainEvent('payment.completed')).toBe(true);
    expect(isCriticalDomainEvent('billing.invoice.paid')).toBe(true);
    expect(isCriticalDomainEvent('invoice.created')).toBe(true);
    expect(isCriticalDomainEvent('appointment.checked_in')).toBe(true);
    expect(isCriticalDomainEvent('queue.metrics.updated')).toBe(false);
    expect(isCriticalDomainEvent('cache.hit')).toBe(false);
    expect(isCriticalDomainEvent(undefined)).toBe(false);
  });

  it('buckets per source and event type', () => {
    expect(resolveEventRateLimitKey('EventService', 'appointment.created')).not.toBe(
      resolveEventRateLimitKey('EventService', 'queue.metrics.updated')
    );
    expect(resolveEventRateLimitKey('', '')).toBe('rate_limit:unknown:unknown');
  });
});
