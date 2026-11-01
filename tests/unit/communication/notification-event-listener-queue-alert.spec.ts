/**
 * Regression (release E2E D11): queue patient alerts are `appointment.queue.patient_alert`, so the
 * generic `appointment.` content branch used to swallow them and the push read
 * "Notification / You have a new notification" instead of the emitter's text.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { NotificationEventListener } from '@communication/listeners/notification-event.listener';
import { QUEUE_PATIENT_ALERT_EVENT } from '@communication/listeners/queue-patient-alert.util';

type ListenerDeps = ConstructorParameters<typeof NotificationEventListener>;
type ContentFn = (
  eventType: string,
  payload: Record<string, unknown>,
  rule: Record<string, unknown>
) => { title: string; body: string };

function contentOf(listener: NotificationEventListener): ContentFn {
  const fn = (listener as unknown as { generateCommunicationContent: ContentFn })
    .generateCommunicationContent;
  return fn.bind(listener);
}

function createListener(): NotificationEventListener {
  return new NotificationEventListener(
    {
      emit: jest.fn(),
      emitAsync: jest.fn(),
      emitEnterprise: jest.fn(),
      on: jest.fn(),
      onAny: jest.fn(),
    } as unknown as ListenerDeps[0],
    { send: jest.fn() } as unknown as ListenerDeps[1],
    { get: jest.fn() } as unknown as ListenerDeps[2],
    {} as unknown as ListenerDeps[3],
    { log: jest.fn() } as unknown as ListenerDeps[4]
  );
}

describe('NotificationEventListener queue patient alert content', () => {
  it('uses the emitter-built text for NEXT and NEAR alerts', () => {
    const generate = contentOf(createListener());
    const next = generate(
      QUEUE_PATIENT_ALERT_EVENT,
      {
        userId: 'u-1',
        metadata: {
          title: "You're next",
          body: "You're next in the queue (token A-004). Dr. Deshmukh will call you shortly.",
        },
      },
      {}
    );
    expect(next).toEqual({
      title: "You're next",
      body: "You're next in the queue (token A-004). Dr. Deshmukh will call you shortly.",
    });
    const near = generate(
      QUEUE_PATIENT_ALERT_EVENT,
      {
        userId: 'u-1',
        metadata: {
          title: '2 ahead of you',
          body: '2 patients ahead of you in the queue. Please be near the consultation room.',
        },
      },
      {}
    );
    expect(near.title).toBe('2 ahead of you');
    expect(near.body).not.toBe('You have a new notification');
  });

  it('falls back to queue wording, never the generic default', () => {
    const generate = contentOf(createListener());
    expect(generate(QUEUE_PATIENT_ALERT_EVENT, { userId: 'u-1', metadata: {} }, {})).toEqual({
      title: 'Queue update',
      body: 'Your turn is coming up soon.',
    });
  });
});
