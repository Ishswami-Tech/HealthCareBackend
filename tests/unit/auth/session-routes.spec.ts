/// <reference types="jest" />
/**
 * Active sessions (S5): `GET /auth/sessions` lists the caller's sessions from the real session
 * store (current one first, flagged), and `DELETE /auth/sessions/:id` / `DELETE /user/sessions/:id`
 * revoke only the caller's own session; another user's session id is a 404, never a leak.
 */

jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('@core/session/session-management.service', () => ({
  SessionManagementService: class {},
}));
jest.mock('@services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@services/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@services/auth/core/jwt.service', () => ({ JwtAuthService: class {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@core/errors', () => ({
  HealthcareErrorsService: class {},
  HealthcareError: class HealthcareError extends Error {},
}));
jest.mock('@services/users/services/location-management.service', () => ({
  LocationManagementService: class {},
}));

import { NotFoundException, RequestMethod } from '@nestjs/common';
import type { SessionData } from '@core/types/session.types';
import { listUserSessionViews, revokeOwnSession } from '@services/auth/core/session-view.util';
import { AuthController } from '@services/auth/auth.controller';
import { UsersController } from '@services/users/controllers/users.controller';

function session(over: Partial<SessionData> & { sessionId: string }): SessionData {
  return {
    userId: 'user-1',
    clinicId: 'clinic-1',
    userAgent: 'Mozilla/5.0',
    ipAddress: '10.0.0.1',
    loginTime: new Date('2026-10-01T08:00:00Z'),
    lastActivity: new Date('2026-10-01T09:00:00Z'),
    expiresAt: new Date('2026-10-02T08:00:00Z'),
    isActive: true,
    metadata: {},
    ...over,
  };
}

function fakeStore(rows: SessionData[]) {
  const byId = new Map(rows.map(row => [row.sessionId, row]));
  return {
    getUserSessions: jest.fn(async (userId: string) =>
      [...byId.values()].filter(row => row.userId === userId)
    ),
    getSession: jest.fn(async (id: string) => byId.get(id) ?? null),
    invalidateSession: jest.fn(async (id: string) => byId.delete(id)),
  };
}

describe('listUserSessionViews', () => {
  it('maps the store rows to the settings-screen shape, current first then most recent', () => {
    const views = listUserSessionViews(
      [
        session({ sessionId: 'old', lastActivity: new Date('2026-10-01T07:00:00Z') }),
        session({ sessionId: 'newest', lastActivity: new Date('2026-10-01T11:00:00Z') }),
        session({ sessionId: 'current', lastActivity: new Date('2026-10-01T09:00:00Z') }),
      ],
      'current'
    );

    expect(views.map(view => view.id)).toEqual(['current', 'newest', 'old']);
    expect(views[0]).toMatchObject({
      id: 'current',
      isCurrent: true,
      deviceInfo: { userAgent: 'Mozilla/5.0', deviceId: null },
      ipAddress: '10.0.0.1',
      clinicId: 'clinic-1',
      createdAt: new Date('2026-10-01T08:00:00Z'),
      lastActivity: new Date('2026-10-01T09:00:00Z'),
    });
    expect(views[1]?.isCurrent).toBe(false);
  });
});

describe('revokeOwnSession', () => {
  it('invalidates the caller’s own session', async () => {
    const store = fakeStore([session({ sessionId: 'mine' })]);

    await expect(revokeOwnSession(store, 'user-1', 'mine')).resolves.toEqual({
      sessionId: 'mine',
      revoked: true,
      wasCurrent: false,
    });
    expect(store.invalidateSession).toHaveBeenCalledWith('mine');
  });

  it.each([
    ['another user’s session', 'theirs'],
    ['an unknown session id', 'nope'],
  ])('answers %s with 404 and revokes nothing', async (_label, id) => {
    const store = fakeStore([session({ sessionId: 'theirs', userId: 'user-2' })]);

    await expect(revokeOwnSession(store, 'user-1', id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.invalidateSession).not.toHaveBeenCalled();
  });
});

describe('AuthController sessions routes', () => {
  function controller(store: ReturnType<typeof fakeStore>): AuthController {
    return new AuthController(
      {} as never,
      {} as never,
      {} as never,
      store as never,
      {} as never,
      {} as never
    );
  }

  it('GET sessions reads the session store for the JWT subject and flags the current session', async () => {
    const store = fakeStore([
      session({ sessionId: 'a' }),
      session({ sessionId: 'b' }),
      session({ sessionId: 'other', userId: 'user-2' }),
    ]);

    const response = await controller(store).getUserSessions({
      user: { sub: 'user-1', sessionId: 'b' },
    } as never);

    expect(store.getUserSessions).toHaveBeenCalledWith('user-1');
    expect(response.data.map(view => [view.id, view.isCurrent])).toEqual([
      ['b', true],
      ['a', false],
    ]);
  });

  it('DELETE sessions/:id revokes own session and reports whether it was the current one', async () => {
    const store = fakeStore([session({ sessionId: 'a' }), session({ sessionId: 'b' })]);

    const response = await controller(store).revokeSession('b', {
      user: { sub: 'user-1', sessionId: 'b' },
    } as never);

    expect(response.data).toEqual({ sessionId: 'b', revoked: true, wasCurrent: true });
  });

  it('DELETE sessions/:id of another user is a 404', async () => {
    const store = fakeStore([session({ sessionId: 'theirs', userId: 'user-2' })]);

    await expect(
      controller(store).revokeSession('theirs', { user: { sub: 'user-1' } } as never)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is no longer a cached stub: the sessions handler has no cache metadata', () => {
    const handler = AuthController.prototype.getUserSessions as unknown as object;
    const keys = Reflect.getMetadataKeys(handler).map(String);
    expect(keys.some(key => key.toLowerCase().includes('cache'))).toBe(false);
  });
});

describe('UsersController DELETE user/sessions/:id', () => {
  function controller(store: ReturnType<typeof fakeStore>): UsersController {
    return new UsersController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      store as never
    );
  }

  it('is registered as DELETE sessions/:id with no role restriction', () => {
    const handler = UsersController.prototype.revokeMySession as unknown as object;
    expect(Reflect.getMetadata('path', handler)).toBe('sessions/:id');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.DELETE);
    expect(Reflect.getMetadata('roles', handler)).toBeUndefined();
  });

  it('revokes the caller’s own session', async () => {
    const store = fakeStore([session({ sessionId: 'mine' })]);

    await expect(
      controller(store).revokeMySession('mine', {
        user: { sub: 'user-1', sessionId: 'x' },
      } as never)
    ).resolves.toEqual({ success: true, sessionId: 'mine', revoked: true, wasCurrent: false });
  });

  it('cannot revoke another user’s session', async () => {
    const store = fakeStore([session({ sessionId: 'theirs', userId: 'user-2' })]);

    await expect(
      controller(store).revokeMySession('theirs', { user: { sub: 'user-1' } } as never)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.invalidateSession).not.toHaveBeenCalled();
  });
});
