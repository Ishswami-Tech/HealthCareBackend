/**
 * POST /appointments/plugins/execute(-batch): plugin operations run for the clinic ClinicGuard
 * validated, not for a clinicId the request body carries.
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('uuid', () => ({ v4: () => '00000000-0000-4000-8000-000000000000' }));
jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@services/video/video.service', () => ({ VideoService: class VideoService {} }));
jest.mock('@services/video/video-consultation-tracker.service', () => ({
  VideoConsultationTracker: class VideoConsultationTracker {},
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AppointmentPluginController } from '@services/appointments/plugins/plugin.controller';
import { ClinicVideoPlugin } from '@services/appointments/plugins/video/clinic-video.plugin';

function build() {
  const manager = {
    executePluginOperation: jest.fn(async (..._args: unknown[]) => ({ success: true })),
  };
  const health = { updatePluginMetrics: jest.fn(async (..._args: unknown[]) => undefined) };
  const controller = new AppointmentPluginController(
    manager as never,
    {} as never,
    health as never
  );
  return { controller, manager };
}

const validatedRequest = { clinicContext: { clinicId: 'clinic-validated' } } as never;
const globalSuperAdminRequest = {} as never;

describe('AppointmentPluginController clinic scoping', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    h = build();
  });

  it('overrides a body-supplied clinicId with the validated clinic (execute)', async () => {
    await h.controller.executePluginOperation(
      {
        domain: 'clinic',
        feature: 'video',
        operation: 'startConsultationSession',
        data: { appointmentId: 'a-1', clinicId: 'clinic-from-body', userId: 'u-1' },
      },
      validatedRequest
    );

    expect(h.manager.executePluginOperation).toHaveBeenCalledWith(
      'clinic',
      'video',
      'startConsultationSession',
      { appointmentId: 'a-1', clinicId: 'clinic-validated', userId: 'u-1' }
    );
  });

  it('supplies the validated clinic when the body had none', async () => {
    await h.controller.executePluginOperation(
      { domain: 'clinic', feature: 'video', operation: 'x', data: { appointmentId: 'a-1' } },
      validatedRequest
    );

    expect(h.manager.executePluginOperation).toHaveBeenCalledWith('clinic', 'video', 'x', {
      appointmentId: 'a-1',
      clinicId: 'clinic-validated',
    });
  });

  it('applies the same override to every operation of a batch', async () => {
    await h.controller.executePluginOperations(
      {
        operations: [
          { domain: 'clinic', feature: 'video', operation: 'a', data: { clinicId: 'other-1' } },
          { domain: 'clinic', feature: 'video', operation: 'b', data: { clinicId: 'other-2' } },
        ],
      },
      validatedRequest
    );

    const clinics = h.manager.executePluginOperation.mock.calls.map(
      call => (call[3] as { clinicId: string }).clinicId
    );
    expect(clinics).toEqual(['clinic-validated', 'clinic-validated']);
  });

  it('leaves non-object data untouched and keeps global scope without a validated clinic', async () => {
    await h.controller.executePluginOperation(
      { domain: 'clinic', feature: 'video', operation: 'a', data: 'raw' },
      validatedRequest
    );
    await h.controller.executePluginOperation(
      { domain: 'clinic', feature: 'video', operation: 'b', data: { clinicId: 'chosen' } },
      globalSuperAdminRequest
    );

    expect(h.manager.executePluginOperation).toHaveBeenNthCalledWith(
      1,
      'clinic',
      'video',
      'a',
      'raw'
    );
    expect(h.manager.executePluginOperation).toHaveBeenNthCalledWith(2, 'clinic', 'video', 'b', {
      clinicId: 'chosen',
    });
  });
});

/**
 * Identity written into a plugin request body is untrusted: the controller replaces it with the
 * authenticated user (JWT) before any plugin sees it.
 */
describe('AppointmentPluginController caller binding', () => {
  let h: ReturnType<typeof build>;

  beforeEach(() => {
    h = build();
  });

  const adminRequest = {
    user: { id: 'admin-1', sub: 'admin-1', role: 'CLINIC_ADMIN' },
    clinicContext: { clinicId: 'clinic-validated' },
  } as never;

  const pharmacistRequest = {
    user: { id: 'pharm-1', role: 'PHARMACIST' },
    clinicContext: { clinicId: 'clinic-validated' },
  } as never;

  const firstOperationData = (): Record<string, unknown> =>
    h.manager.executePluginOperation.mock.calls[0]?.[3] as Record<string, unknown>;

  function buildVideoPlugin() {
    const videoService = {
      generateMeetingToken: jest.fn(async (..._args: unknown[]) => ({ token: 't' })),
      startConsultation: jest.fn(async (..._args: unknown[]) => ({ id: 'session' })),
      endConsultation: jest.fn(async (..._args: unknown[]) => ({ id: 'session' })),
    };
    const plugin = new ClinicVideoPlugin(videoService as never, {} as never, undefined);
    // The real manager hands `data` (which carries `operation`) straight to plugin.process.
    h.manager.executePluginOperation.mockImplementation(
      async (_domain: unknown, _feature: unknown, _operation: unknown, data: unknown) => ({
        success: true,
        data: await plugin.process(data),
      })
    );
    return videoService;
  }

  describe('video operations', () => {
    const forged = {
      operation: 'endConsultationSession',
      appointmentId: 'a-1',
      userId: 'treating-doctor-user',
      userRole: 'doctor',
      rawRole: 'SUPER_ADMIN',
      caller: { userId: 'treating-doctor-user', role: 'DOCTOR' },
      clinicId: 'clinic-from-body',
      sessionNotes: 'done',
    };

    it('replaces a forged userId / userRole / rawRole with the authenticated admin identity', async () => {
      await h.controller.executePluginOperation(
        {
          domain: 'clinic',
          feature: 'consultation-rooms',
          operation: 'endConsultationSession',
          data: forged,
        },
        adminRequest
      );

      expect(firstOperationData()).toEqual({
        operation: 'endConsultationSession',
        appointmentId: 'a-1',
        sessionNotes: 'done',
        clinicId: 'clinic-validated',
        userId: 'admin-1',
        userRole: 'clinic_admin',
        rawRole: 'CLINIC_ADMIN',
        caller: { userId: 'admin-1', role: 'CLINIC_ADMIN' },
      });
    });

    it.each(['video-calls', 'consultation-rooms', 'recording', 'real-time-tracking'])(
      'does so for the %s feature',
      async feature => {
        await h.controller.executePluginOperation(
          { domain: 'clinic', feature, operation: 'x', data: forged },
          adminRequest
        );

        expect(firstOperationData()).toMatchObject({ userId: 'admin-1', userRole: 'clinic_admin' });
      }
    );

    it('a SUPER_ADMIN is bound as clinic_admin with their own raw role', async () => {
      await h.controller.executePluginOperation(
        { domain: 'clinic', feature: 'video-calls', operation: 'x', data: forged },
        {
          user: { id: 'root-1', role: 'SUPER_ADMIN' },
          clinicContext: { clinicId: 'clinic-validated' },
        } as never
      );

      expect(firstOperationData()).toMatchObject({
        userId: 'root-1',
        userRole: 'clinic_admin',
        rawRole: 'SUPER_ADMIN',
      });
    });

    it('end to end: userRole doctor + the treating doctor user id is evaluated as the admin', async () => {
      const videoService = buildVideoPlugin();

      await h.controller.executePluginOperation(
        {
          domain: 'clinic',
          feature: 'consultation-rooms',
          operation: 'endConsultationSession',
          data: forged,
        },
        adminRequest
      );

      expect(videoService.endConsultation).toHaveBeenCalledTimes(1);
      expect(videoService.endConsultation).toHaveBeenCalledWith(
        'a-1',
        'admin-1', // not the doctor user id
        'clinic_admin', // not 'doctor'
        'done',
        { clinicId: 'clinic-validated', rawRole: 'CLINIC_ADMIN' }
      );
      const call = videoService.endConsultation.mock.calls[0] as unknown[];
      expect(call).not.toContain('treating-doctor-user');
      expect(call).not.toContain('doctor');
    });

    it('end to end: userRole receptionist cannot be used to claim an owner token either', async () => {
      const videoService = buildVideoPlugin();

      await h.controller.executePluginOperation(
        {
          domain: 'clinic',
          feature: 'video-calls',
          operation: 'generateJoinToken',
          data: {
            operation: 'generateJoinToken',
            appointmentId: 'a-1',
            userId: 'booking-patient-user',
            userRole: 'receptionist',
            displayName: { name: 'Admin', email: 'a@example.com' },
          },
        },
        adminRequest
      );

      expect(videoService.generateMeetingToken).toHaveBeenCalledWith(
        'a-1',
        'admin-1',
        'clinic_admin',
        { displayName: 'Admin', email: '' },
        { clinicId: 'clinic-validated', rawRole: 'CLINIC_ADMIN' }
      );
    });

    it('a video operation without an authenticated user is a 401, not a plugin result, and nothing runs', async () => {
      await expect(
        h.controller.executePluginOperation(
          { domain: 'clinic', feature: 'video-calls', operation: 'x', data: forged },
          validatedRequest
        )
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(h.manager.executePluginOperation).not.toHaveBeenCalled();
    });

    it('a role that has no video participant role is a 403 and nothing runs', async () => {
      await expect(
        h.controller.executePluginOperation(
          { domain: 'clinic', feature: 'video-calls', operation: 'x', data: forged },
          pharmacistRequest
        )
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(h.manager.executePluginOperation).not.toHaveBeenCalled();
    });

    it('the batch endpoint binds every operation, and one rejected operation runs none of them', async () => {
      await h.controller.executePluginOperations(
        {
          operations: [
            { domain: 'clinic', feature: 'video-calls', operation: 'a', data: forged },
            { domain: 'clinic', feature: 'consultation-rooms', operation: 'b', data: forged },
          ],
        },
        adminRequest
      );
      const bound = h.manager.executePluginOperation.mock.calls.map(
        call => (call[3] as { userId: string }).userId
      );
      expect(bound).toEqual(['admin-1', 'admin-1']);

      h.manager.executePluginOperation.mockClear();
      await expect(
        h.controller.executePluginOperations(
          {
            operations: [
              { domain: 'clinic', feature: 'reminder-scheduling', operation: 'a', data: {} },
              { domain: 'clinic', feature: 'video-calls', operation: 'b', data: forged },
            ],
          },
          pharmacistRequest
        )
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.manager.executePluginOperation).not.toHaveBeenCalled();
    });
  });

  describe('other plugins', () => {
    it('get the authenticated caller under `caller` (a forged one is overwritten) and keep their own userId', async () => {
      await h.controller.executePluginOperation(
        {
          domain: 'clinic',
          feature: 'confirmation',
          operation: 'markAppointmentCompleted',
          data: {
            operation: 'markAppointmentCompleted',
            appointmentId: 'a-1',
            userId: 'patient-user', // the patient, not the actor, for this plugin
            caller: { userId: 'someone-else', role: 'SUPER_ADMIN' },
          },
        },
        adminRequest
      );

      expect(firstOperationData()).toMatchObject({
        userId: 'patient-user',
        clinicId: 'clinic-validated',
        caller: { userId: 'admin-1', role: 'CLINIC_ADMIN' },
      });
      expect(firstOperationData()).not.toHaveProperty('userRole');
    });

    it('without an authenticated user the data is left as it was (clinic scoping only)', async () => {
      await h.controller.executePluginOperation(
        {
          domain: 'clinic',
          feature: 'confirmation',
          operation: 'x',
          data: { appointmentId: 'a-1' },
        },
        validatedRequest
      );

      expect(firstOperationData()).toEqual({ appointmentId: 'a-1', clinicId: 'clinic-validated' });
    });
  });
});
