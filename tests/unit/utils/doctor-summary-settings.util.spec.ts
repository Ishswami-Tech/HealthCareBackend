/// <reference types="jest" />
/**
 * Clinic.settings.appointmentSettings.doctorSummary: when doctors get their WhatsApp summaries.
 * Reads fall back per field to the defaults; the PUT /clinics/:id sanitizer stores clean values.
 */

import {
  DEFAULT_DOCTOR_SUMMARY_SETTINGS,
  mergeDoctorSummaryPatch,
  resolveDoctorSummarySettings,
  sanitizeDoctorSummarySettings,
} from '@utils/doctor-summary-settings.util';
import { mergeClinicSettings } from '@services/clinic/clinic.service';

describe('resolveDoctorSummarySettings', () => {
  it('uses the defaults (7 AM, 15 minutes before each window) when nothing is stored', () => {
    expect(resolveDoctorSummarySettings({})).toEqual(DEFAULT_DOCTOR_SUMMARY_SETTINGS);
    expect(resolveDoctorSummarySettings(null)).toEqual({
      morningEnabled: true,
      morningTime: '07:00',
      beforeWindowEnabled: true,
      beforeWindowMinutes: 15,
    });
  });

  it('reads the stored values from Clinic.settings or from appointmentSettings', () => {
    const doctorSummary = {
      morningEnabled: false,
      morningTime: '06:30',
      beforeWindowEnabled: true,
      beforeWindowMinutes: 30,
    };
    expect(resolveDoctorSummarySettings({ appointmentSettings: { doctorSummary } })).toEqual(
      doctorSummary
    );
    expect(resolveDoctorSummarySettings({ doctorSummary })).toEqual(doctorSummary);
  });

  it('falls back field by field, so an invalid value never switches summaries off', () => {
    expect(
      resolveDoctorSummarySettings({
        appointmentSettings: {
          doctorSummary: { morningEnabled: 'no', morningTime: '25:00', beforeWindowMinutes: 2 },
        },
      })
    ).toEqual(DEFAULT_DOCTOR_SUMMARY_SETTINGS);
  });
});

describe('sanitizeDoctorSummarySettings', () => {
  it('leaves a patch without doctorSummary untouched', () => {
    const patch = { videoCallWindow: { start: '14:00', end: '17:00' } };
    expect(sanitizeDoctorSummarySettings(patch)).toBe(patch);
  });

  it('stores normalized values and drops unknown or invalid fields', () => {
    expect(
      sanitizeDoctorSummarySettings({
        doctorSummary: {
          morningEnabled: true,
          morningTime: '6:05',
          beforeWindowEnabled: false,
          beforeWindowMinutes: '20',
          extra: 'x',
        },
      })
    ).toEqual({
      doctorSummary: {
        morningEnabled: true,
        morningTime: '06:05',
        beforeWindowEnabled: false,
        beforeWindowMinutes: 20,
      },
    });
    expect(
      sanitizeDoctorSummarySettings({
        doctorSummary: { morningTime: '7am', beforeWindowMinutes: 500, morningEnabled: false },
      })
    ).toEqual({ doctorSummary: { morningEnabled: false } });
  });

  it('keeps null (reset to defaults) and removes a value that is not an object', () => {
    expect(sanitizeDoctorSummarySettings({ doctorSummary: null })).toEqual({
      doctorSummary: null,
    });
    expect(sanitizeDoctorSummarySettings({ doctorSummary: 'off', other: 1 })).toEqual({
      other: 1,
    });
    expect(sanitizeDoctorSummarySettings({ doctorSummary: { junk: true } })).toEqual({});
  });
});

describe('saving doctorSummary (sanitize + mergeClinicSettings + mergeDoctorSummaryPatch)', () => {
  const save = (stored: Record<string, unknown>, appointmentSettings: Record<string, unknown>) => {
    const patch = { appointmentSettings: sanitizeDoctorSummarySettings(appointmentSettings) };
    return mergeDoctorSummaryPatch(stored, mergeClinicSettings(stored, patch), patch);
  };
  const stored = {
    paymentSettings: { provider: 'x' },
    appointmentSettings: {
      videoCallWindow: { start: '14:00', end: '17:00' },
      doctorSummary: { morningEnabled: false, morningTime: '06:30', beforeWindowMinutes: 20 },
    },
  };

  it('keeps the stored fields a partial patch does not set', () => {
    const merged = save(stored, { doctorSummary: { beforeWindowMinutes: 30 } });
    expect(merged?.['appointmentSettings']).toEqual({
      videoCallWindow: { start: '14:00', end: '17:00' },
      doctorSummary: { morningEnabled: false, morningTime: '06:30', beforeWindowMinutes: 30 },
    });
    expect(merged?.['paymentSettings']).toEqual({ provider: 'x' });
    expect(resolveDoctorSummarySettings(merged).morningEnabled).toBe(false);
  });

  it('keeps the stored value when the patched field is invalid', () => {
    const merged = save(stored, { doctorSummary: { morningTime: '', beforeWindowMinutes: 30 } });
    expect(resolveDoctorSummarySettings(merged)).toMatchObject({
      morningTime: '06:30',
      beforeWindowMinutes: 30,
    });
  });

  it('resets to the defaults with null', () => {
    const merged = save(stored, { doctorSummary: null });
    expect(resolveDoctorSummarySettings(merged)).toEqual(DEFAULT_DOCTOR_SUMMARY_SETTINGS);
  });

  it('leaves doctorSummary alone when a save does not mention it', () => {
    const merged = save(stored, { videoCallWindow: { start: '15:00', end: '18:00' } });
    expect(resolveDoctorSummarySettings(merged).morningTime).toBe('06:30');
  });
});
