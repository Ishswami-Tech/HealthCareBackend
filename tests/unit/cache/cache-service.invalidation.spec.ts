/// <reference types="jest" />
/**
 * Targeted invalidations that used to rely on an exact `<template>:<id>:*` pattern.
 *
 * HealthcareCacheInterceptor keys now look like
 * `clinic:<clinicId>:<template>:<handler>[:<actor>]:q-<digest>` (and the appointments reads use
 * custom keys with the caller/clinic/role after the user id), so those patterns match nothing.
 * The deterministic path is the tag index; patterns only work with a leading `*`.
 */

import { CacheService } from '@infrastructure/cache/cache.service';

const APPOINTMENT = 'appointment-0000-0001';
const USER = 'user-0000-0001';

interface InvalidationSpy {
  readonly service: CacheService;
  readonly tags: string[];
  readonly patterns: string[];
  readonly logs: jest.Mock;
}

/** The invalidation methods only use the two primitives below and the logger. */
function createService(failTag?: string): InvalidationSpy {
  const tags: string[] = [];
  const patterns: string[] = [];
  const logs = jest.fn().mockResolvedValue(undefined);
  const service = Object.create(CacheService.prototype) as CacheService;
  Object.assign(service, {
    loggingService: { log: logs },
    invalidateCacheByTag: jest.fn((tag: string) => {
      if (tag === failTag) return Promise.reject(new Error('tag index unavailable'));
      tags.push(tag);
      return Promise.resolve(1);
    }),
    invalidateCacheByPattern: jest.fn((pattern: string) => {
      patterns.push(pattern);
      return Promise.resolve(1);
    }),
  });
  return { service, tags, patterns, logs };
}

/** Redis-style glob (`*` only) as a RegExp. */
function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}

describe('CacheService targeted invalidations', () => {
  describe('invalidateVideoCacheForAppointment', () => {
    it('invalidates the appointment tag the video read routes register', async () => {
      const spy = createService();

      const result = await spy.service.invalidateVideoCacheForAppointment(APPOINTMENT);

      expect(result).toBe(true);
      expect(spy.tags).toEqual([`appointment:${APPOINTMENT}`]);
    });

    it('uses leading-wildcard patterns that reach clinic-prefixed interceptor keys', async () => {
      const spy = createService();
      const storedKey = `clinic:c1:video:consultation:status:${APPOINTMENT}:getConsultationStatus:u-p1:q-0123456789ab`;

      await spy.service.invalidateVideoCacheForAppointment(APPOINTMENT);

      // CacheRepository.invalidateByPattern appends `:v*` to the pattern; entries are stored as `<key>:v<N>`.
      const reaches = spy.patterns.some(pattern =>
        globToRegExp(`${pattern}:v*`).test(`${storedKey}:v1`)
      );
      expect(reaches).toBe(true);
      expect(spy.patterns).toContain(`*video:consultation:details:${APPOINTMENT}:*`);
    });

    it('does not reach another appointment', async () => {
      const spy = createService();

      await spy.service.invalidateVideoCacheForAppointment(APPOINTMENT);

      const other = `clinic:c1:video:consultation:status:other-appointment:h:q-0123456789ab:v1`;
      expect(spy.patterns.some(pattern => globToRegExp(`${pattern}:v*`).test(other))).toBe(false);
    });

    it('still runs the patterns when the tag index fails, and does not throw', async () => {
      const spy = createService(`appointment:${APPOINTMENT}`);

      const result = await spy.service.invalidateVideoCacheForAppointment(APPOINTMENT);

      expect(result).toBe(true);
      expect(spy.patterns).toHaveLength(2);
      expect(spy.logs).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('Failed to invalidate video cache tag'),
        'CacheService',
        expect.objectContaining({ appointmentId: APPOINTMENT })
      );
    });
  });

  describe('invalidateUpcomingAppointmentsCache', () => {
    it('invalidates the tag the upcoming reads register plus the user tag, and no dead pattern', async () => {
      const spy = createService();

      const count = await spy.service.invalidateUpcomingAppointmentsCache(USER);

      expect(spy.tags).toEqual(['upcoming_appointments', `user:${USER}`]);
      expect(spy.patterns).toEqual([]);
      expect(count).toBe(2);
    });
  });

  describe('invalidateMyAppointmentsCache', () => {
    it('invalidates the my-appointments tags and no dead pattern', async () => {
      const spy = createService();

      await spy.service.invalidateMyAppointmentsCache(USER);

      expect(spy.tags).toEqual([
        'my_appointments',
        'patient_appointments',
        'appointments',
        `user:${USER}`,
      ]);
      expect(spy.patterns).toEqual([]);
    });
  });
});
