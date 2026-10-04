/**
 * ClinicVideoPlugin must hand VideoService the clinic the caller is acting in: VideoService
 * authorizes join / start / end against it and answers 404 when it is missing. The plugin runs
 * inside a user-initiated request, so it never supplies a SUPER_ADMIN / system bypass.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/video/video.service', () => ({ VideoService: class VideoService {} }));
jest.mock('@services/video/video-consultation-tracker.service', () => ({
  VideoConsultationTracker: class VideoConsultationTracker {},
}));

import { ClinicVideoPlugin } from '@services/appointments/plugins/video/clinic-video.plugin';

function build() {
  const videoService = {
    generateMeetingToken: jest.fn(async (..._args: unknown[]) => ({ token: 't' })),
    startConsultation: jest.fn(async (..._args: unknown[]) => ({ id: 'session' })),
    endConsultation: jest.fn(async (..._args: unknown[]) => ({ id: 'session' })),
  };
  const tracker = {};
  const logging = { log: jest.fn(async (..._args: unknown[]) => undefined) };
  const plugin = new ClinicVideoPlugin(videoService as never, tracker as never, logging as never);
  return { plugin, videoService };
}

const base = {
  appointmentId: 'appt-1',
  userId: 'user-1',
  userRole: 'doctor' as const,
  clinicId: 'clinic-1',
};

describe('ClinicVideoPlugin clinic context', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    h = build();
  });

  it('generateJoinToken forwards { clinicId, rawRole } as the fifth VideoService argument', async () => {
    await h.plugin.process({
      operation: 'generateJoinToken',
      ...base,
      displayName: { name: 'Dr Rao', email: 'dr@example.com' },
    });

    expect(h.videoService.generateMeetingToken).toHaveBeenCalledWith(
      'appt-1',
      'user-1',
      'doctor',
      { displayName: 'Dr Rao', email: '' },
      { clinicId: 'clinic-1', rawRole: 'doctor' }
    );
  });

  it('startConsultationSession forwards the context as the fourth argument', async () => {
    await h.plugin.process({ operation: 'startConsultationSession', ...base });

    expect(h.videoService.startConsultation).toHaveBeenCalledWith('appt-1', 'user-1', 'doctor', {
      clinicId: 'clinic-1',
      rawRole: 'doctor',
    });
  });

  it('endConsultationSession forwards the notes and the context as the fifth argument', async () => {
    await h.plugin.process({
      operation: 'endConsultationSession',
      ...base,
      userRole: 'patient',
      sessionNotes: 'all good',
    });

    expect(h.videoService.endConsultation).toHaveBeenCalledWith(
      'appt-1',
      'user-1',
      'patient',
      'all good',
      { clinicId: 'clinic-1', rawRole: 'patient' }
    );
  });

  it('never claims a privileged raw role: the context carries only the participant role', async () => {
    await h.plugin.process({ operation: 'startConsultationSession', ...base });

    const caller = h.videoService.startConsultation.mock.calls[0]?.[3] as { rawRole?: string };
    expect(String(caller.rawRole).toUpperCase()).not.toBe('SUPER_ADMIN');
    expect(String(caller.rawRole).toUpperCase()).not.toBe('SYSTEM');
  });

  it.each(['generateJoinToken', 'startConsultationSession', 'endConsultationSession'])(
    '%s without a clinic fails closed and never reaches VideoService',
    async operation => {
      const { clinicId: _omitted, ...withoutClinic } = base;

      await expect(
        h.plugin.process({
          operation,
          ...withoutClinic,
          displayName: { name: 'Dr Rao', email: 'dr@example.com' },
        })
      ).rejects.toThrow(/clinicId is required/);

      expect(h.videoService.generateMeetingToken).not.toHaveBeenCalled();
      expect(h.videoService.startConsultation).not.toHaveBeenCalled();
      expect(h.videoService.endConsultation).not.toHaveBeenCalled();
    }
  );

  it('uses the raw platform role the plugin controller bound, not the participant role, as the context', async () => {
    await h.plugin.process({
      operation: 'startConsultationSession',
      ...base,
      userRole: 'clinic_admin',
      rawRole: 'CLINIC_ADMIN',
    });

    expect(h.videoService.startConsultation).toHaveBeenCalledWith(
      'appt-1',
      'user-1',
      'clinic_admin',
      { clinicId: 'clinic-1', rawRole: 'CLINIC_ADMIN' }
    );
  });

  it.each(['patient', 'doctor', 'receptionist', 'clinic_admin'] as const)(
    'accepts the %s video role',
    async userRole => {
      expect(
        await h.plugin.validate({ operation: 'startConsultationSession', ...base, userRole })
      ).toBe(true);
    }
  );

  it('rejects a role that is not a video role', async () => {
    await expect(
      h.plugin.process({
        operation: 'startConsultationSession',
        ...base,
        userRole: 'admin' as never,
      })
    ).rejects.toThrow(/Invalid video plugin data/);
  });

  it.each(['createVideoCall', 'createConsultationRoom'])(
    '%s keeps returning its compatibility stub and never calls VideoService',
    async operation => {
      const result = await h.plugin.process({
        operation,
        appointmentId: 'appt-1',
        patientId: 'p-1',
        doctorId: 'd-1',
        clinicId: 'clinic-1',
      });

      expect(result).toEqual({ success: true, message: 'Room creation is handled dynamically.' });
      expect(h.videoService.generateMeetingToken).not.toHaveBeenCalled();
    }
  );

  it('tracks a non-patient participant on the clinical side', async () => {
    const tracker = {
      trackParticipantJoined: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const plugin = new ClinicVideoPlugin(h.videoService as never, tracker as never, undefined);

    await plugin.process({
      operation: 'trackParticipantJoined',
      appointmentId: 'appt-1',
      userId: 'admin-1',
      userRole: 'clinic_admin',
    });

    expect(tracker.trackParticipantJoined).toHaveBeenCalledWith(
      'appt-1',
      'admin-1',
      'doctor',
      undefined
    );
  });

  describe('validate() requires clinicId for join / start / end', () => {
    const complete = {
      generateJoinToken: { ...base, displayName: { name: 'Dr Rao', email: 'dr@example.com' } },
      startConsultationSession: { ...base },
      endConsultationSession: { ...base },
    };

    it.each(Object.keys(complete) as Array<keyof typeof complete>)(
      '%s: valid with a clinic, invalid without one',
      async operation => {
        const payload = { operation, ...complete[operation] };
        const { clinicId: _omitted, ...withoutClinic } = payload;

        expect(await h.plugin.validate(payload)).toBe(true);
        expect(await h.plugin.validate(withoutClinic)).toBe(false);
      }
    );
  });
});
