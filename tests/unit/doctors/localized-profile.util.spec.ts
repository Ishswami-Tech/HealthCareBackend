import { describe, it, expect } from '@jest/globals';
import {
  LocalizedProfileValidationError,
  normalizeLocalizedProfile,
  pickLocalizedProfile,
} from '../../../src/services/doctors/localized-profile.util';

describe('normalizeLocalizedProfile', () => {
  it('accepts a valid multi-locale profile and keeps emoji icons', () => {
    const input = {
      en: {
        name: 'Dr. A',
        headline: 'Ayurvedacharya',
        highlights: [{ icon: '\u{1F468}‍⚕️', text: 'One' }],
      },
      mr: { name: 'डॉ. अ' },
    };
    expect(normalizeLocalizedProfile(input)).toEqual(input);
  });

  it('rejects unknown locales and unknown fields with 400', () => {
    expect(() => normalizeLocalizedProfile({ fr: { name: 'x' } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(() => normalizeLocalizedProfile({ en: { bio: 'x' } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(() => normalizeLocalizedProfile({ en: { highlights: [{ text: 'a', x: 1 }] } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(() => normalizeLocalizedProfile('en')).toThrow(LocalizedProfileValidationError);
    expect(() => normalizeLocalizedProfile([])).toThrow(LocalizedProfileValidationError);
  });

  it('rejects over-long values and too many highlights', () => {
    expect(() => normalizeLocalizedProfile({ en: { name: 'a'.repeat(121) } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(() => normalizeLocalizedProfile({ en: { headline: 'a'.repeat(301) } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(() =>
      normalizeLocalizedProfile({ en: { highlights: [{ text: 'a'.repeat(201) }] } })
    ).toThrow(LocalizedProfileValidationError);
    expect(() =>
      normalizeLocalizedProfile({ en: { highlights: [{ icon: '123456789', text: 'a' }] } })
    ).toThrow(LocalizedProfileValidationError);
    const many = Array.from({ length: 21 }, (_, i) => ({ text: `h${i}` }));
    expect(() => normalizeLocalizedProfile({ en: { highlights: many } })).toThrow(
      LocalizedProfileValidationError
    );
    expect(normalizeLocalizedProfile({ en: { name: 'a'.repeat(120) } })?.en?.name?.length).toBe(
      120
    );
  });

  it('returns null for empty input', () => {
    expect(normalizeLocalizedProfile(null)).toBeNull();
    expect(normalizeLocalizedProfile(undefined)).toBeNull();
    expect(normalizeLocalizedProfile({})).toBeNull();
    expect(
      normalizeLocalizedProfile({ en: { name: '  ', headline: '', highlights: [{ text: ' ' }] } })
    ).toBeNull();
  });

  it('trims whitespace, strips control characters and drops empty highlights', () => {
    const out = normalizeLocalizedProfile({
      en: {
        name: '  Dr.\u0000 Asha\u0007  ',
        highlights: [{ text: '  keep  ', icon: '  ' }, { text: '' }, { icon: 'x' }],
      },
    });
    expect(out).toEqual({ en: { name: 'Dr. Asha', highlights: [{ text: 'keep' }] } });
  });
});

describe('pickLocalizedProfile', () => {
  const profile = { en: { name: 'EN' }, mr: { name: 'MR' } };

  it('prefers the requested locale', () => {
    expect(pickLocalizedProfile(profile, 'mr')?.name).toBe('MR');
    expect(pickLocalizedProfile(profile, 'mr-IN')?.name).toBe('MR');
  });

  it('falls back to en, then first available', () => {
    expect(pickLocalizedProfile(profile, 'hi')?.name).toBe('EN');
    expect(pickLocalizedProfile({ mr: { name: 'MR' } }, 'hi')?.name).toBe('MR');
  });

  it('returns null for missing or malformed data', () => {
    expect(pickLocalizedProfile(null, 'en')).toBeNull();
    expect(pickLocalizedProfile([], 'en')).toBeNull();
    expect(pickLocalizedProfile({}, 'en')).toBeNull();
    expect(pickLocalizedProfile(profile)?.name).toBe('EN');
  });
});
