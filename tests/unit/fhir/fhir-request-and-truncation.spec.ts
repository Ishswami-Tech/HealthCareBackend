import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_EXPORT_PURPOSE,
  mapWithConcurrency,
  parseExportReason,
  parsePatientParam,
  truncateUserAgent,
} from '@services/fhir/fhir-request.util';
import { buildCollectionBundle, buildSearchsetBundle } from '@services/fhir/mappers/bundle.mapper';
import { mapEncounter } from '@services/fhir/mappers/encounter.mapper';
import { mapPatient } from '@services/fhir/mappers/patient.mapper';
import { buildTruncationOutcome } from '@services/fhir/mappers/operation-outcome';

const NOW = new Date('2026-10-10T10:00:00.000Z');

describe('parsePatientParam', () => {
  it('accepts a plain id and a Patient/ reference', () => {
    expect(parsePatientParam('abc-123')).toEqual({ ok: true, value: 'abc-123' });
    expect(parsePatientParam(' Patient/abc ')).toEqual({ ok: true, value: 'abc' });
  });

  it('rejects a repeated parameter (array) instead of throwing', () => {
    const result = parsePatientParam(['a', 'b']);
    expect(result.ok).toBe(false);
  });

  it('rejects missing, empty, too long and malformed values', () => {
    expect(parsePatientParam(undefined).ok).toBe(false);
    expect(parsePatientParam('  ').ok).toBe(false);
    expect(parsePatientParam('a'.repeat(65)).ok).toBe(false);
    expect(parsePatientParam('a'.repeat(64)).ok).toBe(true);
    expect(parsePatientParam('a b').ok).toBe(false);
    expect(parsePatientParam("a'; drop").ok).toBe(false);
  });
});

describe('parseExportReason', () => {
  it('defaults when absent or blank', () => {
    expect(parseExportReason(undefined)).toEqual({ ok: true, value: DEFAULT_EXPORT_PURPOSE });
    expect(parseExportReason('   ')).toEqual({ ok: true, value: 'treatment' });
  });

  it('trims a valid reason and enforces the 200 char limit', () => {
    expect(parseExportReason('  referral to Dr X ')).toEqual({
      ok: true,
      value: 'referral to Dr X',
    });
    expect(parseExportReason('x'.repeat(200)).ok).toBe(true);
    expect(parseExportReason('x'.repeat(201)).ok).toBe(false);
  });

  it('rejects a repeated parameter', () => {
    expect(parseExportReason(['a', 'b']).ok).toBe(false);
  });
});

describe('truncateUserAgent', () => {
  it('caps at 256 characters and ignores empty values', () => {
    expect(truncateUserAgent('u'.repeat(300))).toHaveLength(256);
    expect(truncateUserAgent('curl/8')).toBe('curl/8');
    expect(truncateUserAgent('')).toBeUndefined();
    expect(truncateUserAgent(undefined)).toBeUndefined();
  });
});

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` calls at once and keeps input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 4, async item => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>(resolve => setTimeout(resolve, 5 + (item % 3)));
      inFlight -= 1;
      return item * 2;
    });
    expect(peak).toBe(4);
    expect(results).toEqual(items.map(i => i * 2));
  });

  it('handles empty input and propagates errors', async () => {
    expect(await mapWithConcurrency([], 4, async (x: number) => x)).toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], 2, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });
});

describe('truncation warning in bundles', () => {
  const encounter = mapEncounter(
    {
      id: 'v1',
      opdNumber: 'O1',
      registrationDate: NOW,
      patientId: 'p1',
      doctorId: null,
      presentComplaints: null,
    },
    NOW
  );
  const warning = buildTruncationOutcome(20, 35);

  it('builds a warning/incomplete outcome that states included of total', () => {
    expect(warning.issue[0]).toMatchObject({ severity: 'warning', code: 'incomplete' });
    expect(warning.issue[0]?.diagnostics).toContain('20 of 35');
  });

  it('searchset keeps total = matches and adds an outcome entry', () => {
    const bundle = buildSearchsetBundle([encounter], NOW, warning);
    expect(bundle.total).toBe(1);
    expect(bundle.entry).toHaveLength(2);
    expect(bundle.entry[1]).toEqual({ resource: warning, search: { mode: 'outcome' } });
    expect(bundle.entry[0]).toMatchObject({ search: { mode: 'match' } });
  });

  it('searchset without truncation has no outcome entry', () => {
    expect(buildSearchsetBundle([encounter], NOW).entry).toHaveLength(1);
  });

  it('collection adds the outcome and sets total to the resource count only when truncated', () => {
    const patient = mapPatient({ id: 'p1', name: 'A' }, []);
    const truncated = buildCollectionBundle([patient, encounter], NOW, warning);
    expect(truncated.total).toBe(2);
    expect(truncated.entry).toHaveLength(3);
    expect(truncated.entry[2]?.resource.resourceType).toBe('OperationOutcome');
    const complete = buildCollectionBundle([patient, encounter], NOW);
    expect(complete.total).toBeUndefined();
    expect(complete.entry).toHaveLength(2);
  });
});
