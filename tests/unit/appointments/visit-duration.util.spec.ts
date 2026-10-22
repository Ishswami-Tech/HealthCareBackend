/**
 * Visit length per clinic (clinic settings JSON, no new table): in-person 3 min, video 15 min by
 * default, resolved on the server by appointment type. src/libs/utils/visit-duration.util.ts
 */
import {
  DEFAULT_IN_PERSON_VISIT_MINUTES,
  DEFAULT_VIDEO_VISIT_MINUTES,
  normalizeVisitMinutes,
  resolveClinicVisitDurations,
  resolveVisitDurationMinutes,
  sanitizeVisitDurationSettings,
} from '@utils/visit-duration.util';
import { DEFAULT_APPOINTMENT_DURATION_MINUTES } from '@core/types/treatment-catalog.types';
import { mergeClinicSettings } from '@services/clinic/clinic.service';

describe('visit duration resolution', () => {
  it('defaults: in-person 3, video 15; catalogue fallback 10', () => {
    expect(DEFAULT_IN_PERSON_VISIT_MINUTES).toBe(3);
    expect(DEFAULT_VIDEO_VISIT_MINUTES).toBe(15);
    expect(DEFAULT_APPOINTMENT_DURATION_MINUTES).toBe(10);
    expect(resolveClinicVisitDurations(null)).toEqual({
      inPersonMinutes: 3,
      videoMinutes: 15,
    });
    expect(resolveVisitDurationMinutes({}, 'IN_PERSON')).toBe(3);
    expect(resolveVisitDurationMinutes({}, 'VIDEO_CALL')).toBe(15);
  });

  it('reads Clinic.settings.appointmentSettings (or the appointmentSettings object itself)', () => {
    const settings = {
      appointmentSettings: {
        inPersonDurationMinutes: 5,
        videoDurationMinutes: 20,
      },
    };
    expect(resolveVisitDurationMinutes(settings, 'IN_PERSON')).toBe(5);
    expect(resolveVisitDurationMinutes(settings, 'VIDEO_CALL')).toBe(20);
    expect(resolveVisitDurationMinutes(settings.appointmentSettings, 'VIDEO_CALL')).toBe(20);
  });

  it('every non-video type is an in-person visit (walk-ins too)', () => {
    const settings = { appointmentSettings: { inPersonDurationMinutes: 4 } };
    expect(resolveVisitDurationMinutes(settings, 'HOME_VISIT')).toBe(4);
    expect(resolveVisitDurationMinutes(settings, undefined)).toBe(4);
  });

  it('honours the legacy appointmentDuration for in-person only, the new key wins', () => {
    expect(
      resolveVisitDurationMinutes({ appointmentSettings: { appointmentDuration: 8 } }, 'IN_PERSON')
    ).toBe(8);
    expect(
      resolveVisitDurationMinutes({ appointmentSettings: { appointmentDuration: 8 } }, 'VIDEO_CALL')
    ).toBe(15);
    expect(
      resolveVisitDurationMinutes(
        {
          appointmentSettings: {
            appointmentDuration: 8,
            inPersonDurationMinutes: 3,
          },
        },
        'IN_PERSON'
      )
    ).toBe(3);
  });

  it('ignores invalid stored values', () => {
    for (const bad of [0, -3, 500, 'abc', null, true, Number.NaN]) {
      expect(
        resolveVisitDurationMinutes(
          { appointmentSettings: { inPersonDurationMinutes: bad } },
          'IN_PERSON'
        )
      ).toBe(3);
    }
    expect(normalizeVisitMinutes('5')).toBe(5);
    expect(normalizeVisitMinutes(4.6)).toBe(5);
  });
});

describe('saving the settings (PUT /clinics/:id)', () => {
  it('stores whole minutes, drops invalid values, keeps null (reset to default)', () => {
    expect(
      sanitizeVisitDurationSettings({
        inPersonDurationMinutes: '4',
        videoDurationMinutes: 999,
        opdControls: { isOpdPaused: false },
      })
    ).toEqual({
      inPersonDurationMinutes: 4,
      opdControls: { isOpdPaused: false },
    });
    expect(sanitizeVisitDurationSettings({ videoDurationMinutes: null })).toEqual({
      videoDurationMinutes: null,
    });
  });

  it('merges into the stored appointmentSettings without wiping other keys', () => {
    const merged = mergeClinicSettings(
      {
        appointmentSettings: {
          opdControls: { isOpdPaused: true },
          videoDurationMinutes: 15,
        },
      },
      { appointmentSettings: { inPersonDurationMinutes: 5 } }
    );
    expect(resolveClinicVisitDurations(merged)).toEqual({
      inPersonMinutes: 5,
      videoMinutes: 15,
    });
    expect((merged?.['appointmentSettings'] as Record<string, unknown>)['opdControls']).toEqual({
      isOpdPaused: true,
    });
  });
});
