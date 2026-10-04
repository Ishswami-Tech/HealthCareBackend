/// <reference types="jest" />
/**
 * Notification inbox (S8 / M7):
 *  - CommunicationService persists title / category / data / appointmentId on the inbox row;
 *  - GET communication/history/:userId returns them (+ readAt) and mark-read stamps readAt;
 *  - the inbox routes accept every role (staff bells were 403);
 *  - push subscribe / device-token act for the JWT subject and ignore a body userId, and no
 *    longer require `notifications:create`.
 */

jest.mock('@infrastructure/events/event.service', () => ({ EventService: class {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class {} }));
jest.mock('@infrastructure/database/database.service', () => ({ DatabaseService: class {} }));
jest.mock('@communication/channels/socket/socket.service', () => ({ SocketService: class {} }));
jest.mock('@communication/channels/push/push.service', () => ({
  PushNotificationService: class {},
}));
jest.mock('@communication/channels/push/device-token.service', () => ({
  DeviceTokenService: class {},
}));
jest.mock('@communication/channels/email/email.service', () => ({ EmailService: class {} }));
jest.mock('@communication/channels/email/email-templates.service', () => ({
  EmailTemplatesService: class {},
}));
jest.mock('@communication/channels/whatsapp/whatsapp.service', () => ({
  WhatsAppService: class {},
}));
jest.mock('@communication/channels/push/sns-backup.service', () => ({
  SNSBackupService: class {},
}));
jest.mock('@communication/channels/chat/chat-backup.service', () => ({
  ChatBackupService: class {},
}));
jest.mock('@communication/services/communication-alerting.service', () => ({
  CommunicationAlertingService: class {},
}));
jest.mock('@communication/communication-health-monitor.service', () => ({
  CommunicationHealthMonitorService: class {},
}));
jest.mock('@config/config.service', () => ({ ConfigService: class {} }));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));

import { CommunicationCategory } from '@core/types';
import { Role } from '@core/types/enums.types';
import { CommunicationService } from '@communication/communication.service';
import {
  CommunicationController,
  toNotificationInboxItem,
} from '@communication/communication.controller';
import { DEVICE_OWNER_ROLES } from '@communication/channels/push/device-token.controller';

const ALL_ROLES = Object.values(Role) as string[];

describe('CommunicationService.buildInboxFields', () => {
  const build = (request: Record<string, unknown>) =>
    CommunicationService.prototype.buildInboxFields.call(
      CommunicationService.prototype,
      request as never
    );

  it('maps the request to title / category / data / appointmentId', () => {
    const fields = build({
      category: CommunicationCategory.APPOINTMENT,
      title: ' Appointment confirmed ',
      body: 'See you at 10:00',
      recipients: [],
      data: {
        eventType: 'appointment.confirmed',
        metadata: { appointmentId: 'apt-1', when: new Date('2026-10-05T04:30:00Z') },
      },
    });

    expect(fields).toEqual({
      title: 'Appointment confirmed',
      category: 'APPOINTMENT',
      appointmentId: 'apt-1',
      data: {
        eventType: 'appointment.confirmed',
        metadata: { appointmentId: 'apt-1', when: '2026-10-05T04:30:00.000Z' },
        appointmentId: 'apt-1',
      },
    });
  });

  it.each([
    [CommunicationCategory.REMINDER, 'REMINDER'],
    [CommunicationCategory.PRESCRIPTION, 'PRESCRIPTION'],
    [CommunicationCategory.BILLING, 'BILLING'],
    [CommunicationCategory.EHR_RECORD, 'EHR'],
    [CommunicationCategory.LOGIN, 'SYSTEM'],
    [undefined, 'SYSTEM'],
  ])('maps category %s to %s', (category, expected) => {
    expect(build({ category, title: 't', body: 'b', recipients: [] }).category).toBe(expected);
  });

  it('reads appointmentId from request.metadata and tolerates a missing title', () => {
    const fields = build({
      category: CommunicationCategory.SYSTEM,
      title: '',
      body: 'b',
      recipients: [],
      metadata: { appointmentId: 'apt-9' },
    });
    expect(fields).toMatchObject({
      title: null,
      appointmentId: 'apt-9',
      data: { appointmentId: 'apt-9' },
    });
  });
});

describe('toNotificationInboxItem', () => {
  it('exposes the inbox fields and falls back to data.appointmentId / SYSTEM', () => {
    const createdAt = new Date('2026-10-04T00:00:00Z');
    expect(
      toNotificationInboxItem({
        id: 'n1',
        userId: 'u1',
        type: 'PUSH_NOTIFICATION',
        message: 'm',
        read: false,
        status: 'SENT',
        createdAt,
        data: { appointmentId: 'apt-1', route: '/appointments/apt-1' },
      })
    ).toEqual({
      id: 'n1',
      userId: 'u1',
      type: 'PUSH_NOTIFICATION',
      title: null,
      category: 'SYSTEM',
      message: 'm',
      read: false,
      isRead: false,
      readAt: null,
      status: 'SENT',
      appointmentId: 'apt-1',
      data: { appointmentId: 'apt-1', route: '/appointments/apt-1' },
      createdAt,
    });
  });
});

describe('CommunicationController inbox routes', () => {
  function controller(overrides: {
    databaseService?: Record<string, jest.Mock>;
    deviceTokenService?: Record<string, jest.Mock>;
    pushService?: Record<string, jest.Mock>;
  }): CommunicationController {
    return new CommunicationController(
      {} as never,
      (overrides.pushService ?? {}) as never,
      (overrides.deviceTokenService ?? {}) as never,
      {} as never,
      {} as never,
      {} as never,
      (overrides.databaseService ?? {}) as never,
      {} as never,
      {} as never,
      {} as never
    );
  }

  it('GET history/:userId returns title, category, data, appointmentId and readAt', async () => {
    const readAt = new Date('2026-10-04T01:00:00Z');
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        type: 'PUSH_NOTIFICATION',
        message: 'Your visit is confirmed',
        read: true,
        readAt,
        status: 'SENT',
        createdAt: new Date('2026-10-04T00:00:00Z'),
        title: 'Appointment confirmed',
        category: 'APPOINTMENT',
        data: { appointmentId: 'apt-1' },
        appointmentId: 'apt-1',
      },
    ]);
    const databaseService = {
      executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) =>
        op({ notification: { findMany } })
      ),
    };

    const result = await controller({ databaseService }).getNotificationHistory(
      'u1',
      undefined,
      undefined,
      'appointment',
      undefined,
      undefined,
      { clinicContext: { clinicId: 'c1' } } as never
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', clinicId: 'c1', category: 'APPOINTMENT' } })
    );
    expect(result.notifications[0]).toMatchObject({
      title: 'Appointment confirmed',
      category: 'APPOINTMENT',
      appointmentId: 'apt-1',
      data: { appointmentId: 'apt-1' },
      readAt,
      isRead: true,
    });
  });

  it('PATCH history/:id/read stamps readAt and returns the inbox item', async () => {
    const update = jest.fn(async (args: { data: { read: boolean; readAt: Date } }) => ({
      id: 'n1',
      userId: 'u1',
      type: 'PUSH_NOTIFICATION',
      message: 'm',
      status: 'SENT',
      createdAt: new Date(),
      ...args.data,
    }));
    const databaseService = {
      executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) =>
        op({ notification: { update } })
      ),
    };

    const result = await controller({ databaseService }).markNotificationRead('n1', {
      user: { sub: 'u1' },
    } as never);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { read: true, readAt: expect.any(Date) },
    });
    expect(result.notification).toMatchObject({ read: true, readAt: expect.any(Date) });
  });

  it.each([
    'getNotificationHistory',
    'getUnreadNotificationCount',
    'markNotificationRead',
    'markAllNotificationsRead',
    'deleteNotification',
  ] as const)('%s accepts every role', method => {
    const roles = Reflect.getMetadata(
      'roles',
      CommunicationController.prototype[method] as unknown as object
    ) as string[];
    expect([...roles].sort()).toEqual([...ALL_ROLES].sort());
  });

  it('device-token registers for the JWT subject and ignores a body userId', async () => {
    const registerDeviceToken = jest.fn().mockResolvedValue(true);
    await controller({ deviceTokenService: { registerDeviceToken } }).registerDeviceToken(
      { token: 'fcm-token-1234567890', platform: 'web', userId: 'someone-else' } as never,
      { user: { sub: 'u1' } } as never
    );
    expect(registerDeviceToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', token: 'fcm-token-1234567890' })
    );
  });

  it('device-token and push subscribe refuse an unauthenticated request instead of "anonymous"', async () => {
    const registerDeviceToken = jest.fn();
    const subscribeToTopic = jest.fn();
    const c = controller({
      deviceTokenService: { registerDeviceToken },
      pushService: { subscribeToTopic },
    });

    await expect(
      c.registerDeviceToken(
        { token: 'fcm-token-1234567890', platform: 'web' } as never,
        {
          user: {},
        } as never
      )
    ).resolves.toEqual({ success: false, error: 'User not authenticated' });
    await expect(
      c.subscribeToTopic({ deviceToken: 'fcm-token-1234567890', topic: 'clinic-1' }, {
        user: {},
      } as never)
    ).resolves.toEqual({ success: false, error: 'User not authenticated' });
    expect(registerDeviceToken).not.toHaveBeenCalled();
    expect(subscribeToTopic).not.toHaveBeenCalled();
  });

  it('push subscribe forwards token + topic for an authenticated caller', async () => {
    const subscribeToTopic = jest.fn().mockResolvedValue(true);
    await expect(
      controller({ pushService: { subscribeToTopic } }).subscribeToTopic(
        { deviceToken: 'fcm-token-1234567890', topic: 'clinic-1', userId: 'ignored' },
        { user: { sub: 'u1' } } as never
      )
    ).resolves.toEqual({ success: true });
    expect(subscribeToTopic).toHaveBeenCalledWith('fcm-token-1234567890', 'clinic-1');
  });

  it.each(['subscribeToTopic', 'unsubscribeFromTopic', 'registerDeviceToken'] as const)(
    '%s no longer requires an RBAC resource permission',
    method => {
      const handler = CommunicationController.prototype[method] as unknown as object;
      const rbacKeys = Reflect.getMetadataKeys(handler)
        .map(String)
        .filter(key => key.toLowerCase().includes('rbac'));
      expect(rbacKeys.every(key => Reflect.getMetadata(key, handler) === undefined)).toBe(true);
    }
  );
});

describe('POST /devices/me/token roles', () => {
  it('every role may register a device', () => {
    expect([...DEVICE_OWNER_ROLES].sort()).toEqual([...ALL_ROLES].sort());
  });
});
