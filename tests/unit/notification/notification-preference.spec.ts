/// <reference types="jest" />
/**
 * Notification preferences (B4): the first save of a user who still has the implicit defaults
 * creates the row instead of 404-ing, and the bare `PUT` / `DELETE /notification-preferences`
 * routes alias the `/me` handlers.
 */

jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class {} }));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));

import { RequestMethod } from '@nestjs/common';
import { NotificationPreferenceService } from '@services/notification/notification-preference.service';
import { NotificationPreferenceController } from '@services/notification/notification-preference.controller';

const NOW = new Date('2026-10-04T00:00:00Z');

function storedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pref-1',
    userId: 'user-1',
    emailEnabled: true,
    smsEnabled: true,
    pushEnabled: true,
    socketEnabled: true,
    whatsappEnabled: false,
    appointmentEnabled: true,
    ehrEnabled: true,
    billingEnabled: true,
    systemEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: 'UTC',
    categoryPreferences: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function harness(existing: Record<string, unknown> | null) {
  const databaseService = {
    findNotificationPreferenceByUserIdSafe: jest.fn().mockResolvedValue(existing),
    findUserByIdSafe: jest.fn().mockResolvedValue({ id: 'user-1', role: 'PATIENT' }),
    createNotificationPreferenceSafe: jest.fn(async (data: Record<string, unknown>) =>
      storedRow(data)
    ),
    updateNotificationPreferenceSafe: jest.fn(
      async (_userId: string, data: Record<string, unknown>) => storedRow(data)
    ),
  };
  const service = new NotificationPreferenceService(
    databaseService as never,
    { invalidateCacheByTag: jest.fn().mockResolvedValue(0) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    { emit: jest.fn().mockResolvedValue(undefined) } as never
  );
  return { service, databaseService };
}

describe('NotificationPreferenceService.updatePreferences', () => {
  it('creates the row when the user has none yet (first save used to 404)', async () => {
    const { service, databaseService } = harness(null);

    const result = await service.updatePreferences('user-1', { pushEnabled: false });

    expect(databaseService.createNotificationPreferenceSafe).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', pushEnabled: false, emailEnabled: true })
    );
    expect(databaseService.updateNotificationPreferenceSafe).not.toHaveBeenCalled();
    expect(result).toMatchObject({ userId: 'user-1', pushEnabled: false });
  });

  it('updates in place when the row exists', async () => {
    const { service, databaseService } = harness(storedRow());

    await service.updatePreferences('user-1', { smsEnabled: false });

    expect(databaseService.updateNotificationPreferenceSafe).toHaveBeenCalledWith('user-1', {
      smsEnabled: false,
    });
    expect(databaseService.createNotificationPreferenceSafe).not.toHaveBeenCalled();
  });
});

describe('NotificationPreferenceController bare-route aliases', () => {
  function route(method: keyof NotificationPreferenceController): {
    path: unknown;
    method: unknown;
    roles: string[] | undefined;
  } {
    const handler = NotificationPreferenceController.prototype[method] as unknown as object;
    return {
      path: Reflect.getMetadata('path', handler),
      method: Reflect.getMetadata('method', handler),
      roles: Reflect.getMetadata('roles', handler) as string[] | undefined,
    };
  }

  it('PUT /notification-preferences aliases PUT /me with the same roles', () => {
    const alias = route('updateMyPreferencesAlias');
    const me = route('updateMyPreferences');
    expect(alias.path).toBe('/');
    expect(alias.method).toBe(RequestMethod.PUT);
    expect(me.path).toBe('me');
    expect(alias.roles).toEqual(me.roles);
  });

  it('DELETE /notification-preferences aliases DELETE /me with the same roles', () => {
    const alias = route('deleteMyPreferencesAlias');
    const me = route('deleteMyPreferences');
    expect(alias.path).toBe('/');
    expect(alias.method).toBe(RequestMethod.DELETE);
    expect(alias.roles).toEqual(me.roles);
  });

  it('the aliases delegate to the /me handlers with the JWT user', async () => {
    const preferenceService = {
      updatePreferences: jest.fn().mockResolvedValue({ id: 'pref-1' }),
      deletePreferences: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new NotificationPreferenceController(preferenceService as never);
    const req = { user: { sub: 'user-1' } } as never;

    await controller.updateMyPreferencesAlias(req, { pushEnabled: false });
    await controller.deleteMyPreferencesAlias(req);

    expect(preferenceService.updatePreferences).toHaveBeenCalledWith('user-1', {
      pushEnabled: false,
    });
    expect(preferenceService.deletePreferences).toHaveBeenCalledWith('user-1');
  });
});
