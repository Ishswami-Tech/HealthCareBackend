import { describe, expect, it } from '@jest/globals';
import {
  AYURVEDA_LIST_DEFAULT_LIMIT,
  AYURVEDA_LIST_MAX_LIMIT,
  parseAyurvedaListLimit,
  parseAyurvedaListOffset,
  resolveAyurvedaPatientFilter,
} from '../../../src/services/ayurveda/utils/patient-filter.util';

const PATIENT_UUID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const doctor = { id: 'b1c2d3e4-0000-4000-8000-000000000001', role: 'DOCTOR' };
const patient = { id: 'b1c2d3e4-0000-4000-8000-000000000002', role: 'PATIENT' };

describe('resolveAyurvedaPatientFilter', () => {
  it('treats an empty patientId from a doctor as the clinic-scoped recent list', () => {
    expect(resolveAyurvedaPatientFilter('', doctor)).toEqual({ kind: 'clinic' });
  });

  it('treats whitespace or a missing patientId as not provided', () => {
    expect(resolveAyurvedaPatientFilter('   ', doctor)).toEqual({ kind: 'clinic' });
    expect(resolveAyurvedaPatientFilter(undefined, doctor)).toEqual({ kind: 'clinic' });
  });

  it('accepts a UUID and trims it', () => {
    expect(resolveAyurvedaPatientFilter(` ${PATIENT_UUID} `, doctor)).toEqual({
      kind: 'patient',
      patientId: PATIENT_UUID,
    });
  });

  it('rejects a non-UUID patientId', () => {
    expect(resolveAyurvedaPatientFilter('not-a-uuid', doctor)).toEqual({ kind: 'invalid' });
    expect(resolveAyurvedaPatientFilter("1' OR '1'='1", doctor)).toEqual({ kind: 'invalid' });
  });

  it('never gives a patient the clinic-wide list: blank narrows to their own records', () => {
    expect(resolveAyurvedaPatientFilter('', patient)).toEqual({
      kind: 'patient',
      patientId: patient.id,
    });
    expect(resolveAyurvedaPatientFilter('', { role: 'PATIENT' })).toEqual({ kind: 'invalid' });
  });
});

describe('parseAyurvedaListLimit / parseAyurvedaListOffset', () => {
  it('falls back to the default limit for missing or unusable values', () => {
    expect(parseAyurvedaListLimit(undefined)).toBe(AYURVEDA_LIST_DEFAULT_LIMIT);
    expect(parseAyurvedaListLimit('abc')).toBe(AYURVEDA_LIST_DEFAULT_LIMIT);
    expect(parseAyurvedaListLimit('0')).toBe(AYURVEDA_LIST_DEFAULT_LIMIT);
    expect(parseAyurvedaListLimit('-5')).toBe(AYURVEDA_LIST_DEFAULT_LIMIT);
  });

  it('caps the limit', () => {
    expect(parseAyurvedaListLimit('5')).toBe(5);
    expect(parseAyurvedaListLimit('100000')).toBe(AYURVEDA_LIST_MAX_LIMIT);
  });

  it('parses offset as a non-negative integer', () => {
    expect(parseAyurvedaListOffset(undefined)).toBe(0);
    expect(parseAyurvedaListOffset('x')).toBe(0);
    expect(parseAyurvedaListOffset('-3')).toBe(0);
    expect(parseAyurvedaListOffset('40')).toBe(40);
  });
});
