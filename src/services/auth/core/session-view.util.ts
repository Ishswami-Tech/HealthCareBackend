/**
 * Active-session views and the own-session revoke used by `GET /auth/sessions`,
 * `DELETE /auth/sessions/:id` and `DELETE /user/sessions/:id`.
 *
 * Shared by AuthController and UsersController so the two routes cannot drift: both read the real
 * session store (SessionManagementService) and both fail closed on another user's session.
 */
import { NotFoundException } from '@nestjs/common';
import type { SessionData } from '@core/types/session.types';

/** One row of the "active sessions" settings screen. */
export interface UserSessionView {
  id: string;
  deviceInfo: {
    userAgent: string | null;
    deviceId: string | null;
  };
  ipAddress: string | null;
  clinicId: string | null;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

/** The subset of SessionManagementService the revoke needs (keeps the helper mock-friendly). */
export interface SessionRevoker {
  getSession(sessionId: string): Promise<SessionData | null>;
  invalidateSession(sessionId: string): Promise<boolean>;
}

export function toUserSessionView(
  session: SessionData,
  currentSessionId?: string
): UserSessionView {
  return {
    id: session.sessionId,
    deviceInfo: {
      userAgent: session.userAgent ?? null,
      deviceId: session.deviceId ?? null,
    },
    ipAddress: session.ipAddress ?? null,
    clinicId: session.clinicId ?? null,
    isActive: session.isActive,
    isCurrent: Boolean(currentSessionId) && session.sessionId === currentSessionId,
    createdAt: new Date(session.loginTime),
    lastActivity: new Date(session.lastActivity),
    expiresAt: new Date(session.expiresAt),
  };
}

/** Current session first, then most recently active. */
export function listUserSessionViews(
  sessions: readonly SessionData[],
  currentSessionId?: string
): UserSessionView[] {
  return sessions
    .map(session => toUserSessionView(session, currentSessionId))
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }
      return right.lastActivity.getTime() - left.lastActivity.getTime();
    });
}

/**
 * Revoke ONE of the caller's own sessions. A session that does not exist or belongs to another
 * user is reported as not found (never "forbidden"), so session ids cannot be probed.
 */
export async function revokeOwnSession(
  sessions: SessionRevoker,
  userId: string,
  sessionId: string
): Promise<{ sessionId: string; revoked: boolean; wasCurrent: boolean }> {
  const session = await sessions.getSession(sessionId);
  if (!session || session.userId !== userId) {
    throw new NotFoundException('Session not found');
  }
  const revoked = await sessions.invalidateSession(sessionId);
  return { sessionId, revoked, wasCurrent: false };
}
