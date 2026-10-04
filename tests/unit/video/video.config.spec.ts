/// <reference types="jest" />
/**
 * Unit tests for the video configuration defaults.
 *
 * Daily is the production video provider and its rooms must require a meeting token, so both
 * defaults fail closed / to Daily: an unset or unexpected value must never silently produce
 * public rooms or fall back to an unused provider.
 */

import { getDailyPrivacy, getVideoProvider, videoConfig } from '@config/video.config';

const ENV_KEYS = ['DAILY_PRIVACY', 'VIDEO_PROVIDER', 'VIDEO_ENABLED'] as const;

describe('video config defaults', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('getDailyPrivacy', () => {
    it('defaults to private when DAILY_PRIVACY is unset', () => {
      expect(getDailyPrivacy()).toBe('private');
    });

    it.each(['', '   ', 'garbage', 'PUBLIC', 'Public', 'true', '1', 'org', 'private'])(
      'resolves %p to private',
      value => {
        process.env['DAILY_PRIVACY'] = value;
        expect(getDailyPrivacy()).toBe('private');
      }
    );

    it('is public only for the explicit value "public"', () => {
      process.env['DAILY_PRIVACY'] = 'public';
      expect(getDailyPrivacy()).toBe('public');
    });

    it('ignores surrounding whitespace around an explicit "public"', () => {
      process.env['DAILY_PRIVACY'] = ' public\r';
      expect(getDailyPrivacy()).toBe('public');
    });

    it('feeds the Daily section of the video config factory', () => {
      expect(videoConfig().daily?.privacy).toBe('private');

      process.env['DAILY_PRIVACY'] = 'nonsense';
      expect(videoConfig().daily?.privacy).toBe('private');

      process.env['DAILY_PRIVACY'] = 'public';
      expect(videoConfig().daily?.privacy).toBe('public');
    });
  });

  describe('getVideoProvider', () => {
    it('defaults to daily when VIDEO_PROVIDER is unset', () => {
      expect(getVideoProvider()).toBe('daily');
      expect(videoConfig().provider).toBe('daily');
    });

    it('falls back to daily for an unrecognised provider', () => {
      process.env['VIDEO_PROVIDER'] = 'zoom';
      expect(getVideoProvider()).toBe('daily');
    });

    it('falls back to daily when video is disabled', () => {
      process.env['VIDEO_ENABLED'] = 'false';
      expect(getVideoProvider()).toBe('daily');
    });

    it.each([
      ['cloudflare', 'cloudflare'],
      ['daily', 'daily'],
      ['google-meet', 'google-meet'],
      [' Google-Meet ', 'google-meet'],
      ['CLOUDFLARE', 'cloudflare'],
    ] as const)('still honours an explicit VIDEO_PROVIDER of %p', (value, expected) => {
      process.env['VIDEO_PROVIDER'] = value;
      expect(getVideoProvider()).toBe(expected);
    });
  });
});
