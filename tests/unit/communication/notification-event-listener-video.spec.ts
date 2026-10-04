/// <reference types="jest" />
/**
 * NotificationEventListener: the video visit notifications.
 *
 * `video.consultation.started` / `video.consultation.ended` used to log "No recipients found" and
 * notify nobody, because the rule read recipients from fields the video service did not emit. The
 * envelope now carries them (`userId` = the patient's user, `metadata.bookerUserId`,
 * `metadata.actorRole`, `metadata.firstStart`), built by `buildVideoLifecycleRouting`; the tests
 * below run the real emitter helper into the real listener so the two cannot drift apart again.
 * The booker is vetted by VideoService before it reaches the helper (a PATIENT-role user or the
 * owner of the family dependent, never a doctor or other staff): it is passed in explicitly here.
 *
 * Only the collaborators are mocked: no event bus, no database, no provider.
 */

import { EventCategory, EventPriority } from '@core/types';
import { NotificationEventListener } from '@communication/listeners/notification-event.listener';
import { buildVideoLifecycleRouting } from '@services/video/video-completion.helpers';

jest.mock('@infrastructure/events/event.service', () => ({
  EventService: class EventService {},
}));
jest.mock('@communication/communication.service', () => ({
  CommunicationService: class CommunicationService {},
}));
jest.mock('@services/appointments/plugins/notifications/appointment-notification.service', () => ({
  AppointmentNotificationService: class AppointmentNotificationService {},
}));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));

type ListenerDeps = ConstructorParameters<typeof NotificationEventListener>;

interface SentRecipient {
  userId?: string;
  socketRoom?: string;
}

interface SentRequest {
  title: string;
  body: string;
  channels?: string[];
  recipients: SentRecipient[];
  data: Record<string, unknown>;
}

const CLINIC_ID = 'clinic-1';
const APPOINTMENT_ID = 'appt-1';
const PATIENT_USER = 'patient-user';
const BOOKER_USER = 'booker-user';
const DOCTOR_USER = 'doctor-user';

function createListener(): {
  listener: NotificationEventListener;
  send: jest.Mock;
  log: jest.Mock;
} {
  const send = jest.fn().mockResolvedValue({ success: true, requestId: 'req-1' });
  const log = jest.fn().mockResolvedValue(undefined);
  const eventService = {
    emit: jest.fn(),
    emitAsync: jest.fn(),
    emitEnterprise: jest.fn(),
    on: jest.fn(),
    onAny: jest.fn(),
  };
  const listener = new NotificationEventListener(
    eventService as unknown as ListenerDeps[0],
    { send } as unknown as ListenerDeps[1],
    { get: jest.fn() } as unknown as ListenerDeps[2],
    {} as unknown as ListenerDeps[3],
    { log } as unknown as ListenerDeps[4]
  );
  return { listener, send, log };
}

/** The envelope VideoService emits: routing from the helper, plus a payload that is never read. */
function lifecycleEnvelope(
  eventType: 'video.consultation.started' | 'video.consultation.ended',
  appointment: Parameters<typeof buildVideoLifecycleRouting>[0],
  extraMetadata: Parameters<typeof buildVideoLifecycleRouting>[1],
  eligibleBookerUserId?: string
): Record<string, unknown> {
  return {
    eventId: `${eventType}-${appointment.id}-1`,
    eventType,
    category: EventCategory.SYSTEM,
    priority: EventPriority.HIGH,
    timestamp: '2026-03-10T04:30:00.000Z',
    source: 'VideoService',
    version: '1.0.0',
    ...buildVideoLifecycleRouting(appointment, extraMetadata, eligibleBookerUserId),
    payload: {
      appointmentId: appointment.id,
      sessionId: 'vc-1',
      userId: DOCTOR_USER,
      userRole: 'doctor',
      provider: 'daily',
    },
  };
}

function baseAppointment(
  overrides: Partial<Parameters<typeof buildVideoLifecycleRouting>[0]> = {}
): Parameters<typeof buildVideoLifecycleRouting>[0] {
  return {
    id: APPOINTMENT_ID,
    clinicId: CLINIC_ID,
    patient: { userId: PATIENT_USER },
    doctor: { userId: DOCTOR_USER },
    ...overrides,
  };
}

function sentRequest(send: jest.Mock): SentRequest {
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0]?.[0] as SentRequest;
}

function recipientUserIds(request: SentRequest): string[] {
  return request.recipients.map(recipient => recipient.userId ?? '');
}

describe('NotificationEventListener video visit events', () => {
  describe('video.consultation.started', () => {
    it('tells the patient when the doctor starts the visit for the first time', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope('video.consultation.started', baseAppointment(), {
          actorRole: 'doctor',
          firstStart: true,
        })
      );

      const request = sentRequest(send);
      expect(recipientUserIds(request)).toEqual([PATIENT_USER]);
      expect(request.recipients[0]?.socketRoom).toBe(`user:${PATIENT_USER}`);
      expect(request.channels).toEqual(expect.arrayContaining(['push', 'socket']));
      expect(request.title).toBe('Your doctor has joined');
      expect(request.data).toMatchObject({
        eventType: 'video.consultation.started',
        clinicId: CLINIC_ID,
        metadata: expect.objectContaining({ appointmentId: APPOINTMENT_ID }),
      });
    });

    it('never notifies the doctor about their own action', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope('video.consultation.started', baseAppointment(), {
          actorRole: 'doctor',
          firstStart: true,
        })
      );

      expect(recipientUserIds(sentRequest(send))).not.toContain(DOCTOR_USER);
    });

    it('also tells the account that booked the visit when it is not the patient', async () => {
      const { listener, send } = createListener();
      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope(
          'video.consultation.started',
          baseAppointment(),
          { actorRole: 'doctor', firstStart: true },
          BOOKER_USER
        )
      );

      expect(recipientUserIds(sentRequest(send))).toEqual([PATIENT_USER, BOOKER_USER]);
    });

    it('does not notify twice when the booker is the patient', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope(
          'video.consultation.started',
          baseAppointment(),
          { actorRole: 'doctor', firstStart: true },
          PATIENT_USER
        )
      );

      expect(recipientUserIds(sentRequest(send))).toEqual([PATIENT_USER]);
    });

    it('notifies only the booker for a patient without a login of their own', async () => {
      const { listener, send } = createListener();
      const appointment = baseAppointment({ patient: { userId: null } });

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope(
          'video.consultation.started',
          appointment,
          { actorRole: 'doctor', firstStart: true },
          BOOKER_USER
        )
      );

      expect(recipientUserIds(sentRequest(send))).toEqual([BOOKER_USER]);
    });

    it('stays silent when the doctor only rejoins a visit that was already started', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope('video.consultation.started', baseAppointment(), {
          actorRole: 'doctor',
          firstStart: false,
        })
      );

      expect(send).not.toHaveBeenCalled();
    });

    it.each(['patient', 'receptionist', 'clinic_admin'])(
      'stays silent when a %s opens the room (the doctor has not joined)',
      async actorRole => {
        const { listener, send } = createListener();

        await listener.handleEvent(
          'video.consultation.started',
          lifecycleEnvelope('video.consultation.started', baseAppointment(), {
            actorRole,
            firstStart: false,
          })
        );

        expect(send).not.toHaveBeenCalled();
      }
    );

    it('does not send anything, and does not fail, when nobody can be notified', async () => {
      const { listener, send, log } = createListener();
      const appointment = baseAppointment({ patient: { userId: null } });

      await expect(
        listener.handleEvent(
          'video.consultation.started',
          lifecycleEnvelope('video.consultation.started', appointment, {
            actorRole: 'doctor',
            firstStart: true,
          })
        )
      ).resolves.toBeUndefined();

      expect(send).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('No recipients found for event video.consultation.started'),
        'NotificationEventListener',
        expect.anything()
      );
    });

    it('keeps names and ids of people out of the push text', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.started',
        lifecycleEnvelope('video.consultation.started', baseAppointment(), {
          actorRole: 'doctor',
          firstStart: true,
        })
      );

      const { title, body } = sentRequest(send);
      for (const text of [title, body]) {
        expect(text).not.toContain(PATIENT_USER);
        expect(text).not.toContain(DOCTOR_USER);
        expect(text).not.toContain(APPOINTMENT_ID);
      }
    });
  });

  describe('video.consultation.ended', () => {
    it('tells the patient the visit is completed', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope('video.consultation.ended', baseAppointment(), { actorRole: 'doctor' })
      );

      const request = sentRequest(send);
      expect(recipientUserIds(request)).toEqual([PATIENT_USER]);
      expect(request.title).toBe('Consultation completed');
      expect(request.channels).toEqual(expect.arrayContaining(['push', 'socket']));
    });

    it('also tells the booker, and never the doctor', async () => {
      const { listener, send } = createListener();
      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope(
          'video.consultation.ended',
          baseAppointment(),
          { actorRole: 'doctor' },
          BOOKER_USER
        )
      );

      const ids = recipientUserIds(sentRequest(send));
      expect(ids).toEqual([PATIENT_USER, BOOKER_USER]);
      expect(ids).not.toContain(DOCTOR_USER);
    });

    it('never notifies the treating doctor, even when the doctor is passed as the booker', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope(
          'video.consultation.ended',
          baseAppointment(),
          { actorRole: 'doctor' },
          DOCTOR_USER
        )
      );

      const ids = recipientUserIds(sentRequest(send));
      expect(ids).toEqual([PATIENT_USER]);
      expect(ids).not.toContain(DOCTOR_USER);
    });

    it('tells the patient when a clinic admin completed the visit, and nobody else', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope('video.consultation.ended', baseAppointment(), {
          actorRole: 'clinic_admin',
        })
      );

      const request = sentRequest(send);
      expect(recipientUserIds(request)).toEqual([PATIENT_USER]);
      expect(request.title).toBe('Consultation completed');
    });

    it('uses generic text: no diagnosis, no names, no ids', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope('video.consultation.ended', baseAppointment(), { actorRole: 'doctor' })
      );

      const { title, body } = sentRequest(send);
      expect(body).toMatch(/summary/i);
      for (const text of [title, body]) {
        expect(text).not.toContain(PATIENT_USER);
        expect(text).not.toContain(DOCTOR_USER);
        expect(text).not.toContain(APPOINTMENT_ID);
      }
    });
  });

  describe('video.consultation.completion_pending', () => {
    const PATIENT_NAME = 'Asha Verma';

    function pendingEnvelope(
      metadata: Record<string, unknown> = {
        appointmentId: APPOINTMENT_ID,
        doctorUserId: DOCTOR_USER,
        patientName: PATIENT_NAME,
        expiresAtLabel: '05:30 PM',
        stage: 'first',
      }
    ): Record<string, unknown> {
      return {
        eventId: 'pending-1',
        eventType: 'video.consultation.completion_pending',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: '2026-03-10T04:30:00.000Z',
        source: 'VideoScheduler',
        version: '1.0.0',
        userId: DOCTOR_USER,
        clinicId: CLINIC_ID,
        metadata,
        payload: {},
      };
    }

    it('still reminds the doctor, and only the doctor', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent('video.consultation.completion_pending', pendingEnvelope());

      const request = sentRequest(send);
      expect(recipientUserIds(request)).toEqual([DOCTOR_USER]);
      expect(request.channels).toEqual(expect.arrayContaining(['push', 'socket']));
      expect(request.title).toBe('Complete this visit');
    });

    it('uses a generic body: the patient name never reaches the push or socket text', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent('video.consultation.completion_pending', pendingEnvelope());

      const { title, body } = sentRequest(send);
      expect(body).toBe('A video visit is still open — tap to complete it');
      for (const text of [title, body]) {
        expect(text).not.toContain(PATIENT_NAME);
        expect(text).not.toContain('Asha');
        expect(text).not.toContain(APPOINTMENT_ID);
      }
    });

    it('does not put the patient name into the notification data either', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent('video.consultation.completion_pending', pendingEnvelope());

      const { data } = sentRequest(send);
      expect(JSON.stringify(data)).not.toContain(PATIENT_NAME);
      // The deep link target and the rest of the routing data stay.
      expect(data).toMatchObject({
        eventType: 'video.consultation.completion_pending',
        metadata: expect.objectContaining({
          appointmentId: APPOINTMENT_ID,
          doctorUserId: DOCTOR_USER,
          stage: 'first',
        }),
      });
      expect(data['metadata']).not.toHaveProperty('patientName');
    });

    it('gives the same generic text when the scheduler sends no name or expiry label', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.completion_pending',
        pendingEnvelope({ appointmentId: APPOINTMENT_ID, doctorUserId: DOCTOR_USER })
      );

      expect(sentRequest(send).body).toBe('A video visit is still open — tap to complete it');
    });

    it('leaves the metadata of other events untouched', async () => {
      const { listener, send } = createListener();

      await listener.handleEvent(
        'video.consultation.ended',
        lifecycleEnvelope('video.consultation.ended', baseAppointment(), { actorRole: 'doctor' })
      );

      expect(sentRequest(send).data['metadata']).toMatchObject({
        appointmentId: APPOINTMENT_ID,
        actorRole: 'doctor',
      });
    });
  });
});

describe('buildVideoLifecycleRouting', () => {
  it('addresses the patient and the clinic, with no booker unless one was vetted', () => {
    const routing = buildVideoLifecycleRouting(baseAppointment(), { actorRole: 'doctor' });

    expect(routing).toEqual({
      clinicId: CLINIC_ID,
      userId: PATIENT_USER,
      metadata: { appointmentId: APPOINTMENT_ID, actorRole: 'doctor' },
    });
  });

  it('never trusts the raw appointment.userId (whoever created the appointment)', () => {
    const createdByStaff = {
      ...baseAppointment(),
      userId: 'receptionist-user',
    } as Parameters<typeof buildVideoLifecycleRouting>[0];

    const routing = buildVideoLifecycleRouting(createdByStaff, { actorRole: 'doctor' });

    expect(routing.metadata).not.toHaveProperty('bookerUserId');
  });

  it('keeps a vetted booker', () => {
    const routing = buildVideoLifecycleRouting(baseAppointment(), {}, BOOKER_USER);

    expect(routing.metadata).toMatchObject({ bookerUserId: BOOKER_USER });
  });

  it.each([
    ['the patient', PATIENT_USER],
    ['the treating doctor', DOCTOR_USER],
    ['an empty value', ''],
    ['null', null],
  ])('drops a booker that is %s', (_label, booker) => {
    const routing = buildVideoLifecycleRouting(baseAppointment(), {}, booker);

    expect(routing.metadata).not.toHaveProperty('bookerUserId');
  });

  it('omits the patient user when the patient has no login', () => {
    const routing = buildVideoLifecycleRouting(
      baseAppointment({ patient: { userId: null } }),
      {},
      BOOKER_USER
    );

    expect(routing).not.toHaveProperty('userId');
    expect(routing.metadata).toMatchObject({ bookerUserId: BOOKER_USER });
  });
});
