/// <reference types="jest" />
/**
 * Admin force-terminate of a video session (`admin/sessions/:id/terminate`).
 *
 * It used to run the doctor's end path with the admin role, which only logged a "participant left"
 * event and answered 200 while the call kept running. It now closes the provider room, ends the
 * VideoConsultation row and leaves the appointment alone.
 *
 * All collaborators are plain mocks; no database, cache, event bus or provider is touched.
 */

import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';

import { LogLevel, LogType } from '@core/types';
import type { VideoCallerContext } from '@services/video/video-access.helpers';

// VideoService only needs these collaborators as injection tokens (it is built with plain mocks).
jest.mock('@services/billing/billing.service', () => ({ BillingService: class BillingService {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class QueueService {} }));
jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class RbacService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@services/video/providers/video-provider.factory', () => ({
  VideoProviderFactory: class VideoProviderFactory {},
}));

import {
  CLINIC,
  OTHER_CLINIC,
  START_MS,
  captureError,
  createHarness,
  makeAppointment,
  mockNow,
  staffCaller,
} from './video-service.harness';

type Harness = ReturnType<typeof createHarness>;

const ROOM = 'daily-appointment-appt-1-abc123def456';
const RAW_PROVIDER_TEXT =
  'Daily room delete failed with status 503 for https://api.daily.internal.example/v1/rooms/secret';

function arrangeSession(
  clients: Harness['clients'],
  overrides: Record<string, unknown> = {}
): void {
  clients.videoConsultation['findFirst']?.mockResolvedValue({
    id: 'vc-1',
    appointmentId: 'appt-1',
    roomId: ROOM,
    status: 'ACTIVE',
    clinicId: CLINIC,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    ...overrides,
  });
}

const superAdmin: VideoCallerContext = { rawRole: 'SUPER_ADMIN' };

describe('VideoService.terminateConsultation', () => {
  beforeEach(() => {
    mockNow(START_MS);
  });

  it('closes the provider room, ends the session row and leaves the appointment alone', async () => {
    const { service, clients, provider, eventService } = createHarness();
    arrangeSession(clients);

    const result = await service.terminateConsultation('appt-1', 'root-user', superAdmin);

    expect(result).toEqual({ appointmentId: 'appt-1', alreadyEnded: false });
    expect(provider['terminateRoom']).toHaveBeenCalledWith(ROOM);
    expect(provider['endConsultation']).toHaveBeenCalledWith('appt-1', 'root-user', 'clinic_admin');
    // The doctor can still complete it, or the expiry job can close it.
    expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    expect(clients.appointment['update']).not.toHaveBeenCalled();
    expect(eventService.emitEnterprise).not.toHaveBeenCalled();
  });

  it('ejects the room first, then ends the row', async () => {
    const { service, clients, provider } = createHarness();
    arrangeSession(clients);

    await service.terminateConsultation('appt-1', 'root-user', superAdmin);

    const terminate = (provider['terminateRoom'] as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    const end = (provider['endConsultation'] as jest.Mock).mock.invocationCallOrder[0] ?? 0;
    expect(terminate).toBeGreaterThan(0);
    expect(terminate).toBeLessThan(end);
  });

  it('writes a security audit entry with who terminated what', async () => {
    const { service, clients, loggingService } = createHarness();
    arrangeSession(clients);

    await service.terminateConsultation('appt-1', 'root-user', superAdmin);

    expect(loggingService.log).toHaveBeenCalledWith(
      LogType.SECURITY,
      LogLevel.WARN,
      expect.stringContaining('force-terminated'),
      'VideoService.terminateConsultation',
      expect.objectContaining({
        appointmentId: 'appt-1',
        consultationId: 'vc-1',
        terminatedBy: 'root-user',
        terminatedByRole: 'SUPER_ADMIN',
      })
    );
  });

  it('drops the cached appointment data so the status endpoint stops reporting a live call', async () => {
    const { service, clients, cacheService } = createHarness();
    arrangeSession(clients);

    await service.terminateConsultation('appt-1', 'root-user', superAdmin);

    expect(cacheService['invalidateAppointmentCache']).toHaveBeenCalledWith(
      'appt-1',
      'patient-1',
      'doctor-1',
      CLINIC
    );
  });

  it('accepts the consultation id in its video-session form', async () => {
    const { service, clients, provider } = createHarness();
    arrangeSession(clients);

    const result = await service.terminateConsultation('video-session-vc-1', 'root', superAdmin);

    expect(result.appointmentId).toBe('appt-1');
    expect(provider['terminateRoom']).toHaveBeenCalledTimes(1);
  });

  describe('who may terminate', () => {
    it('lets a CLINIC_ADMIN terminate a session of their own clinic', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);

      const result = await service.terminateConsultation(
        'appt-1',
        'admin-user',
        staffCaller('CLINIC_ADMIN')
      );

      expect(result.alreadyEnded).toBe(false);
      expect(provider['terminateRoom']).toHaveBeenCalledTimes(1);
    });

    it('answers 404 to a CLINIC_ADMIN of another clinic and touches nothing', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);

      const error = await captureError(
        service.terminateConsultation(
          'appt-1',
          'admin-user',
          staffCaller('CLINIC_ADMIN', OTHER_CLINIC)
        )
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(provider['terminateRoom']).not.toHaveBeenCalled();
      expect(provider['endConsultation']).not.toHaveBeenCalled();
    });

    it('fails closed for a CLINIC_ADMIN without a clinic context', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);

      const error = await captureError(
        service.terminateConsultation('appt-1', 'admin-user', { rawRole: 'CLINIC_ADMIN' })
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(provider['terminateRoom']).not.toHaveBeenCalled();
    });

    it('lets a SUPER_ADMIN terminate a session of any clinic', async () => {
      const { service, clients, provider, databaseService } = createHarness();
      arrangeSession(clients, { clinicId: OTHER_CLINIC });
      databaseService['findAppointmentByIdSafe']?.mockResolvedValue(
        makeAppointment({ clinicId: OTHER_CLINIC })
      );

      const result = await service.terminateConsultation('appt-1', 'root', superAdmin);

      expect(result.alreadyEnded).toBe(false);
      expect(provider['terminateRoom']).toHaveBeenCalledTimes(1);
    });
  });

  describe('session state', () => {
    it('answers 404 when the appointment has no video session', async () => {
      const { service, clients, provider } = createHarness();
      clients.videoConsultation['findFirst']?.mockResolvedValue(null);

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(provider['terminateRoom']).not.toHaveBeenCalled();
    });

    it.each(['COMPLETED', 'ENDED', 'CANCELLED'])(
      'is a success without calling the provider when the session is already %s',
      async status => {
        const { service, clients, provider } = createHarness();
        arrangeSession(clients, { status });

        const result = await service.terminateConsultation('appt-1', 'root', superAdmin);

        expect(result).toEqual({ appointmentId: 'appt-1', alreadyEnded: true });
        expect(provider['terminateRoom']).not.toHaveBeenCalled();
        expect(provider['endConsultation']).not.toHaveBeenCalled();
      }
    );
  });

  describe('provider limits and failures', () => {
    it('answers 409, and ends nothing, when the provider cannot close its rooms', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);
      delete provider['terminateRoom'];

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect(error).toBeInstanceOf(ConflictException);
      expect(provider['endConsultation']).not.toHaveBeenCalled();
    });

    it('answers 409 when the room was not created by a provider that can close it', async () => {
      const { service, clients, provider } = createHarness();
      // A Cloudflare/Meet style room id: it does not start with the Daily provider name.
      arrangeSession(clients, { roomId: 'meeting-1234' });

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect(error).toBeInstanceOf(ConflictException);
      expect(provider['terminateRoom']).not.toHaveBeenCalled();
      expect(provider['endConsultation']).not.toHaveBeenCalled();
    });

    it('hides the provider text behind a fixed 503 and keeps the row untouched for a retry', async () => {
      const { service, clients, provider, loggingService } = createHarness();
      arrangeSession(clients);
      (provider['terminateRoom'] as jest.Mock).mockRejectedValue(new Error(RAW_PROVIDER_TEXT));

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(503);
      expect(JSON.stringify((error as HttpException).getResponse())).not.toContain(
        'internal.example'
      );
      expect((error as HttpException).message).toContain('Could not terminate the video session');
      expect((error as HttpException).message).not.toContain('internal.example');
      expect(provider['endConsultation']).not.toHaveBeenCalled();
      // The operator still gets the real cause in the log.
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('internal.example'),
        'VideoService.terminateConsultation',
        expect.any(Object)
      );
    });

    it('hides any other failure behind a fixed 500', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);
      (provider['terminateRoom'] as jest.Mock).mockRejectedValue(
        new Error('Daily room delete failed with status 401')
      );

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect((error as HttpException).getStatus()).toBe(500);
      expect((error as HttpException).message).toBe('Could not terminate the video session');
    });

    it('keeps the session open for a retry when ending the row fails after the room is gone', async () => {
      const { service, clients, provider } = createHarness();
      arrangeSession(clients);
      (provider['endConsultation'] as jest.Mock).mockRejectedValue(new Error('db down'));

      const error = await captureError(service.terminateConsultation('appt-1', 'root', superAdmin));

      expect((error as HttpException).getStatus()).toBe(500);
      expect((error as HttpException).message).toBe('Could not terminate the video session');
    });
  });
});
