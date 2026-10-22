import { describe, expect, it } from '@jest/globals';
import { resolveJobPayload } from '@infrastructure/queue/src/job-payload.util';

/** The canonical envelope QueueService.addJob stores (C3: ids live in `data`). */
const envelope = (action: string, data: Record<string, unknown>): Record<string, unknown> => ({
  jobType: 'appointment',
  priority: 'NORMAL',
  domain: 'clinic',
  action,
  data,
  metadata: { domain: 'clinic', auditLevel: 'basic', createdAt: '2026-10-22T00:00:00Z' },
});

describe('resolveJobPayload (C3: worker jobs ran against queue:clinic:undefined:undefined)', () => {
  it('reads the ids of an addJob envelope from the nested data', () => {
    const payload = resolveJobPayload(
      envelope('queue.call_next', {
        doctorId: 'doc-1',
        clinicId: 'clinic-1',
        appointmentId: 'apt-1',
        domain: 'clinic',
      })
    );
    expect(payload['doctorId']).toBe('doc-1');
    expect(payload['clinicId']).toBe('clinic-1');
    expect(payload['appointmentId']).toBe('apt-1');
    expect(payload['action']).toBe('queue.call_next');
    // The queue key every appointment job builds is complete now.
    expect(
      `queue:${String(payload['domain'])}:${String(payload['clinicId'])}:${String(payload['doctorId'])}`
    ).toBe('queue:clinic:clinic-1:doc-1');
  });

  it.each([
    'queue.enqueue',
    'queue.confirm',
    'queue.start_consultation',
    'queue.complete',
    'queue.no_show',
    'queue.pause',
    'queue.resume',
    'queue.reorder',
    'queue.transfer',
  ])('every appointment queue action (%s) keeps its routing action and payload', action => {
    const payload = resolveJobPayload(
      envelope(action, { patientId: 'p-1', clinicId: 'c-1', doctorId: 'd-1', newOrder: ['a'] })
    );
    expect(payload['action']).toBe(action);
    expect(payload['clinicId']).toBe('c-1');
    expect(payload['doctorId']).toBe('d-1');
    expect(payload['patientId']).toBe('p-1');
    expect(payload['newOrder']).toEqual(['a']);
  });

  it('the payload wins over envelope keys of the same name (metadata, domain)', () => {
    const payload = resolveJobPayload(
      envelope('report', { reportId: 'r-1', metadata: { kind: 'lab' }, domain: 'ehr' })
    );
    expect(payload['metadata']).toEqual({ kind: 'lab' });
    expect(payload['domain']).toBe('ehr');
    expect(payload['reportId']).toBe('r-1');
  });

  it('keeps envelope-only keys as a fallback (tenantId)', () => {
    const payload = resolveJobPayload({ ...envelope('x', { a: 1 }), tenantId: 't-1' });
    expect(payload['tenantId']).toBe('t-1');
  });

  it('a flat legacy payload is returned as it is', () => {
    const flat = { action: 'confirm', clinicId: 'c-1', doctorId: 'd-1' };
    expect(resolveJobPayload(flat)).toEqual(flat);
  });

  it('non-object data is an empty payload', () => {
    expect(resolveJobPayload(undefined)).toEqual({});
    expect(resolveJobPayload('x')).toEqual({});
    expect(resolveJobPayload(null)).toEqual({});
  });
});
