/// <reference types="jest" />
/**
 * Unit tests for VideoService consultation lifecycle security and correctness:
 * authorization, clinic isolation, error hygiene, end-consultation state rules,
 * the patient join window, the doctor-start side effects and rating concurrency.
 *
 * All collaborators are plain mocks; no database, cache or provider is touched.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

import { VideoService } from '@services/video/video.service';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { getVideoActiveWindowMinutes, getVideoEarlyJoinMinutes } from '@config/video.config';
import type { VideoCallerContext, VideoCallerRole } from '@services/video/video-access.helpers';

// VideoService only needs these collaborators as injection tokens (it is built with plain mocks
// below). Replacing them keeps the heavy transitive module graphs (billing, queue, prisma, ...)
// out of this unit test.
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
  DOCTOR_USER,
  FOREIGN_USER,
  MINUTE,
  OTHER_CLINIC,
  PATIENT_USER,
  RAW_DB_TEXT,
  START_MS,
  USER_INFO,
  captureError,
  createHarness,
  makeAppointment,
  makeSession,
  mockNow,
  patientCaller,
  staffCaller,
} from './video-service.harness';

describe('VideoService consultation lifecycle', () => {
  beforeEach(() => {
    // Inside the join window by default.
    mockNow(START_MS);
  });

  // ==========================================================================
  // 1. Authorization & clinic isolation
  // ==========================================================================
  describe('authorization', () => {
    describe('generateMeetingToken', () => {
      it('rejects a foreign patient of the same clinic with 403 and never reaches the provider', async () => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            FOREIGN_USER,
            'patient',
            USER_INFO,
            patientCaller()
          )
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(provider['generateMeetingToken']).not.toHaveBeenCalled();
      });

      it('rejects a foreign doctor of the same clinic with 403', async () => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            'other-doctor-user',
            'doctor',
            USER_INFO,
            staffCaller('DOCTOR')
          )
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(provider['generateMeetingToken']).not.toHaveBeenCalled();
      });

      it.each<[VideoCallerRole, string]>([
        ['receptionist', 'RECEPTIONIST'],
        ['receptionist', 'NURSE'],
        ['clinic_admin', 'CLINIC_ADMIN'],
        ['doctor', 'DOCTOR'],
      ])('answers 404 to a %s (%s) of another clinic', async (role, rawRole) => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            role === 'doctor' ? DOCTOR_USER : 'staff-user',
            role,
            USER_INFO,
            staffCaller(rawRole, OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(provider['generateMeetingToken']).not.toHaveBeenCalled();
      });

      it('answers 404 to a patient presenting a different clinic', async () => {
        const { service } = createHarness();

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            PATIENT_USER,
            'patient',
            USER_INFO,
            patientCaller(OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
      });

      it('fails closed when no clinic context is supplied', async () => {
        const { service } = createHarness();

        const error = await captureError(
          service.generateMeetingToken('appt-1', 'staff-user', 'receptionist', USER_INFO)
        );

        expect(error).toBeInstanceOf(NotFoundException);
      });

      it('does not reveal the status of another clinic appointment', async () => {
        const { service, databaseService } = createHarness();
        databaseService['findAppointmentByIdSafe']?.mockResolvedValue(
          makeAppointment({ status: 'CANCELLED' })
        );

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            'staff-user',
            'receptionist',
            USER_INFO,
            staffCaller('RECEPTIONIST', OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toBe('Appointment not found');
      });

      it('issues a token to the appointment patient', async () => {
        const { service, provider } = createHarness();

        const token = await service.generateMeetingToken(
          'appt-1',
          PATIENT_USER,
          'patient',
          USER_INFO,
          patientCaller()
        );

        expect(token.token).toBe('meeting-token');
        expect(provider['generateMeetingToken']).toHaveBeenCalledTimes(1);
      });

      it('issues a token to the owner of the family dependent the visit is for', async () => {
        const { service, clients, databaseService } = createHarness();
        databaseService['findAppointmentByIdSafe']?.mockResolvedValue(
          makeAppointment({ familyMemberId: 'family-1', userId: 'booker-elsewhere' })
        );
        clients.familyMember['findFirst']?.mockResolvedValue({ id: 'family-1' });

        const token = await service.generateMeetingToken(
          'appt-1',
          'dependent-owner',
          'patient',
          USER_INFO,
          patientCaller()
        );

        expect(token.token).toBe('meeting-token');
        expect(clients.familyMember['findFirst']).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: 'family-1', patientId: 'patient-1' }),
          })
        );
      });

      it('rejects a foreign patient even when a dependent is on the appointment', async () => {
        const { service, databaseService } = createHarness();
        databaseService['findAppointmentByIdSafe']?.mockResolvedValue(
          makeAppointment({ familyMemberId: 'family-1' })
        );

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            FOREIGN_USER,
            'patient',
            USER_INFO,
            patientCaller()
          )
        );

        expect(error).toBeInstanceOf(ForbiddenException);
      });

      it.each<[VideoCallerRole, string, string]>([
        ['doctor', 'DOCTOR', DOCTOR_USER],
        ['doctor', 'ASSISTANT_DOCTOR', 'assistant-user'],
        ['receptionist', 'RECEPTIONIST', 'desk-user'],
        ['receptionist', 'NURSE', 'nurse-user'],
        ['clinic_admin', 'CLINIC_ADMIN', 'admin-user'],
      ])(
        'issues a token to the %s (%s) of the appointment clinic',
        async (role, rawRole, userId) => {
          const { service } = createHarness();

          const token = await service.generateMeetingToken(
            'appt-1',
            userId,
            role,
            USER_INFO,
            staffCaller(rawRole)
          );

          expect(token.token).toBe('meeting-token');
        }
      );

      it('lets a SUPER_ADMIN act across clinics', async () => {
        const { service } = createHarness();

        const token = await service.generateMeetingToken(
          'appt-1',
          'root-user',
          'clinic_admin',
          USER_INFO,
          { rawRole: 'SUPER_ADMIN' }
        );

        expect(token.token).toBe('meeting-token');
      });

      it('answers 404 for an unknown appointment', async () => {
        const { service, databaseService } = createHarness();
        databaseService['findAppointmentByIdSafe']?.mockResolvedValue(null);

        const error = await captureError(
          service.generateMeetingToken(
            'appt-1',
            PATIENT_USER,
            'patient',
            USER_INFO,
            patientCaller()
          )
        );

        expect(error).toBeInstanceOf(HealthcareError);
        expect((error as HttpException).getStatus()).toBe(404);
      });
    });

    describe('startConsultation', () => {
      it('rejects a foreign patient with 403', async () => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.startConsultation('appt-1', FOREIGN_USER, 'patient', patientCaller())
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(provider['startConsultation']).not.toHaveBeenCalled();
      });

      it('rejects a foreign doctor with 403', async () => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.startConsultation('appt-1', 'other-doctor', 'doctor', staffCaller('DOCTOR'))
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(provider['startConsultation']).not.toHaveBeenCalled();
      });

      it('answers 404 to clinic staff of another clinic', async () => {
        const { service, provider } = createHarness();

        const error = await captureError(
          service.startConsultation(
            'appt-1',
            'desk-user',
            'receptionist',
            staffCaller('RECEPTIONIST', OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(provider['startConsultation']).not.toHaveBeenCalled();
      });

      it('lets the appointment doctor start the consultation', async () => {
        const { service, provider } = createHarness();

        const session = await service.startConsultation(
          'appt-1',
          DOCTOR_USER,
          'doctor',
          staffCaller('DOCTOR')
        );

        expect(session.id).toBe('vc-1');
        expect(provider['startConsultation']).toHaveBeenCalledTimes(1);
      });
    });

    describe('endConsultation', () => {
      it('rejects a foreign doctor with 403 and does not end anything', async () => {
        const { service, provider, clients } = createHarness();
        clients.appointment['findUnique']?.mockResolvedValue(
          makeAppointment({ status: 'IN_PROGRESS' })
        );

        const error = await captureError(
          service.endConsultation(
            'appt-1',
            'other-doctor',
            'doctor',
            undefined,
            staffCaller('DOCTOR')
          )
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(provider['endConsultation']).not.toHaveBeenCalled();
        expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      });

      it('answers 404 to a doctor presenting another clinic', async () => {
        const { service, provider, clients } = createHarness();
        clients.appointment['findUnique']?.mockResolvedValue(
          makeAppointment({ status: 'IN_PROGRESS' })
        );

        const error = await captureError(
          service.endConsultation(
            'appt-1',
            DOCTOR_USER,
            'doctor',
            undefined,
            staffCaller('DOCTOR', OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(provider['endConsultation']).not.toHaveBeenCalled();
      });
    });

    describe('leaving the call (non-doctor endConsultation)', () => {
      it('rejects a foreign patient with 403 and records nothing', async () => {
        const { service, eventService } = createHarness();

        const error = await captureError(
          service.endConsultation('appt-1', FOREIGN_USER, 'patient', undefined, patientCaller())
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(eventService.emitEnterprise).not.toHaveBeenCalled();
      });

      it('answers 404 to clinic staff of another clinic', async () => {
        const { service, eventService } = createHarness();

        const error = await captureError(
          service.endConsultation(
            'appt-1',
            'desk-user',
            'receptionist',
            undefined,
            staffCaller('RECEPTIONIST', OTHER_CLINIC)
          )
        );

        expect(error).toBeInstanceOf(NotFoundException);
        expect(eventService.emitEnterprise).not.toHaveBeenCalled();
      });

      it('records the leave of the appointment patient without completing the visit', async () => {
        const { service, eventService, clients, provider } = createHarness();

        const session = await service.endConsultation(
          'appt-1',
          PATIENT_USER,
          'patient',
          undefined,
          patientCaller()
        );

        expect(session.id).toBe('vc-1');
        expect(eventService.emitEnterprise).toHaveBeenCalledWith(
          'video.consultation.participant.left',
          expect.any(Object)
        );
        expect(provider['endConsultation']).not.toHaveBeenCalled();
        expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      });

      it.each<[VideoCallerRole, string]>([
        ['receptionist', 'RECEPTIONIST'],
        ['receptionist', 'NURSE'],
        ['clinic_admin', 'SUPER_ADMIN'],
      ])(
        'rejects a %s (%s) with 403 instead of the old silent success, and records nothing',
        async (role, rawRole) => {
          const { service, eventService, provider, clients } = createHarness();

          const error = await captureError(
            service.endConsultation('appt-1', 'desk-user', role, undefined, staffCaller(rawRole))
          );

          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).message).toBe(
            'Only the treating doctor or a clinic admin can end this consultation. Leave the call instead.'
          );
          expect(eventService.emitEnterprise).not.toHaveBeenCalled();
          expect(provider['endConsultation']).not.toHaveBeenCalled();
          expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
        }
      );
    });
  });

  // ==========================================================================
  // 3. endConsultation state rules
  // ==========================================================================
  describe('endConsultation state rules', () => {
    const doctorEnd = (
      service: VideoService,
      caller: VideoCallerContext = staffCaller('DOCTOR')
    ): Promise<unknown> =>
      service.endConsultation('appt-1', DOCTOR_USER, 'doctor', undefined, caller);

    it.each(['CANCELLED', 'NO_SHOW', 'EXPIRED', 'PENDING'])(
      'rejects ending an appointment that is %s with 409 and writes nothing',
      async status => {
        const { service, provider, clients, eventService } = createHarness();
        clients.appointment['findUnique']?.mockResolvedValue(makeAppointment({ status }));

        const error = await captureError(doctorEnd(service));

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toContain(
          status.toLowerCase().replace(/_/g, ' ')
        );
        expect(provider['endConsultation']).not.toHaveBeenCalled();
        expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
        expect(eventService.emitEnterprise).not.toHaveBeenCalled();
      }
    );

    it('is idempotent for an already COMPLETED appointment: success, no write, no event', async () => {
      const { service, provider, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'COMPLETED', completedAt: new Date('2026-03-10T05:00:00Z') })
      );

      const session = (await doctorEnd(service)) as { id: string };

      expect(session.id).toBe('vc-1');
      expect(provider['endConsultation']).not.toHaveBeenCalled();
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    });

    it.each(['CONFIRMED', 'SCHEDULED'])(
      'rejects ending a %s visit that never started with 409 "has not started" and writes nothing',
      async status => {
        const { service, provider, clients, eventService } = createHarness();
        clients.appointment['findUnique']?.mockResolvedValue(makeAppointment({ status }));

        const error = await captureError(doctorEnd(service));

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe('This consultation has not started');
        expect(provider['endConsultation']).not.toHaveBeenCalled();
        expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
        expect(eventService.emitEnterprise).not.toHaveBeenCalled();
      }
    );

    it('completes an IN_PROGRESS appointment with a write conditional on IN_PROGRESS and clinic', async () => {
      const { service, clients, eventService, cacheService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );

      await doctorEnd(service);

      expect(clients.appointment['updateMany']).toHaveBeenCalledTimes(1);
      const args = clients.appointment['updateMany']?.mock.calls[0]?.[0] as {
        where: { id: string; clinicId: string; status: string };
        data: { status: string; completedAt: Date };
      };
      expect(args.where.id).toBe('appt-1');
      expect(args.where.clinicId).toBe(CLINIC);
      // Compare-and-set on IN_PROGRESS only: a visit that raced back to CONFIRMED is not completed.
      expect(args.where.status).toBe('IN_PROGRESS');
      expect(args.data.status).toBe('COMPLETED');
      expect(args.data.completedAt).toBeInstanceOf(Date);
      expect(cacheService['invalidateAppointmentCache']).toHaveBeenCalled();
      expect(eventService.emitEnterprise).toHaveBeenCalledWith(
        'video.consultation.ended',
        expect.any(Object)
      );
    });

    it('does not complete a visit that moved back to CONFIRMED during the request', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
      clients.appointment['findFirst']?.mockResolvedValue({ status: 'CONFIRMED' });

      const error = await captureError(doctorEnd(service));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('This consultation has not started');
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    });

    it('emits the ended event exactly once', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );

      await doctorEnd(service);

      const ended = eventService.emitEnterprise.mock.calls.filter(
        (call: unknown[]) => call[0] === 'video.consultation.ended'
      );
      expect(ended).toHaveLength(1);
    });

    it('does not report success when the appointment moved to CANCELLED during the request', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
      clients.appointment['findFirst']?.mockResolvedValue({ status: 'CANCELLED' });

      const error = await captureError(doctorEnd(service));

      expect(error).toBeInstanceOf(ConflictException);
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    });

    it('treats losing the completion race to another request as success without events', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockResolvedValue({ count: 0 });
      clients.appointment['findFirst']?.mockResolvedValue({ status: 'COMPLETED' });

      const session = (await doctorEnd(service)) as { id: string };

      expect(session.id).toBe('vc-1');
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    });

    it('fails the request when the completion write fails (no swallow-and-log-success)', async () => {
      const { service, clients, eventService, loggingService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      clients.appointment['updateMany']?.mockRejectedValue(new Error(RAW_DB_TEXT));

      const error = await captureError(doctorEnd(service));

      expect(error).toBeInstanceOf(HealthcareError);
      expect((error as HttpException).getStatus()).toBe(500);
      expect((error as HttpException).message).toBe('Could not end the video consultation');
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
      // The raw cause is available to operators in the log...
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('db.internal.example'),
        'VideoService.endConsultation',
        expect.any(Object)
      );
    });

    it('lets the doctor close a visit that never reached the provider (no consultation row)', async () => {
      const { service, provider, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      (provider['endConsultation'] as jest.Mock).mockRejectedValue(
        new HealthcareError(ErrorCode.DATABASE_RECORD_NOT_FOUND, 'none', 404, {}, 'ctx')
      );
      clients.videoConsultation['findFirst']?.mockResolvedValue(null);

      const session = (await doctorEnd(service)) as { status: string };

      expect(session.status).toBe('COMPLETED');
      expect(clients.appointment['updateMany']).toHaveBeenCalledTimes(1);
      expect(eventService.emitEnterprise).toHaveBeenCalledWith(
        'video.consultation.ended',
        expect.any(Object)
      );
    });

    it('rethrows a provider failure when a consultation row does exist', async () => {
      const { service, provider, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS' })
      );
      (provider['endConsultation'] as jest.Mock).mockRejectedValue(new Error('provider exploded'));
      clients.videoConsultation['findFirst']?.mockResolvedValue({ id: 'vc-1' });

      const error = await captureError(doctorEnd(service));

      expect(error).toBeInstanceOf(HealthcareError);
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // 2. Error hygiene
  // ==========================================================================
  describe('error hygiene', () => {
    it('hides raw database text on start: fixed message, no metadata leak, raw text only logged', async () => {
      const { service, provider, loggingService } = createHarness();
      (provider['startConsultation'] as jest.Mock).mockRejectedValue(new Error(RAW_DB_TEXT));

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(HealthcareError);
      const exception = error as HealthcareError;
      expect(exception.getStatus()).toBe(500);
      expect(exception.message).toBe('Could not start the video consultation');
      expect(JSON.stringify(exception.getResponse())).not.toContain('db.internal.example');
      expect(JSON.stringify(exception.metadata)).not.toContain('db.internal.example');
      expect(exception.metadata).toEqual({ appointmentId: 'appt-1' });
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('db.internal.example'),
        'VideoService.startConsultation',
        expect.objectContaining({ error: RAW_DB_TEXT })
      );
    });

    it('hides raw text on token generation too', async () => {
      const { service, provider } = createHarness();
      (provider['generateMeetingToken'] as jest.Mock).mockRejectedValue(
        new Error('Daily room lookup failed with status 401: key=sk_live_secret')
      );

      const error = await captureError(
        service.generateMeetingToken('appt-1', PATIENT_USER, 'patient', USER_INFO, patientCaller())
      );

      const exception = error as HealthcareError;
      expect(exception.getStatus()).toBe(500);
      expect(exception.message).toBe('Could not generate the video meeting token');
      expect(JSON.stringify(exception.getResponse())).not.toContain('sk_live_secret');
    });

    it('hides the message and metadata of a wrapped database HealthcareError', async () => {
      const { service, provider } = createHarness();
      (provider['startConsultation'] as jest.Mock).mockRejectedValue(
        new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          `Write operation failed after 3 attempts: ${RAW_DB_TEXT}`,
          undefined,
          { originalErrorMessage: RAW_DB_TEXT, originalErrorStack: 'at secret.ts:1' },
          'DatabaseService'
        )
      );

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      const exception = error as HealthcareError;
      expect(exception.message).toBe('Could not start the video consultation');
      expect(JSON.stringify(exception.getResponse())).not.toContain('db.internal.example');
      expect(JSON.stringify(exception.getResponse())).not.toContain('secret.ts');
    });

    it('does not turn arbitrary "not found" substrings into 404', async () => {
      const { service, provider } = createHarness();
      (provider['startConsultation'] as jest.Mock).mockRejectedValue(
        new Error('Record not found in table secret_table')
      );

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      const exception = error as HealthcareError;
      expect(exception.getStatus()).toBe(500);
      expect(exception.message).not.toContain('secret_table');
    });

    it.each([
      ['a timed-out provider request', Object.assign(new Error('aborted'), { name: 'AbortError' })],
      ['a network failure', new TypeError('fetch failed')],
      ['a provider 503', new Error('Daily room create failed with status 503')],
    ])('maps %s to 503 with a fixed message', async (_label, providerError) => {
      const { service, provider } = createHarness();
      (provider['startConsultation'] as jest.Mock).mockRejectedValue(providerError);

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      const exception = error as HealthcareError;
      expect(exception).toBeInstanceOf(HealthcareError);
      expect(exception.getStatus()).toBe(503);
      expect(exception.code).toBe(ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE);
      expect(exception.message).toContain('Could not start the video consultation');
      expect(exception.message).not.toContain('Daily');
      expect(exception.message).not.toContain('fetch failed');
    });

    it('keeps NotFound/Forbidden/BadRequest HTTP errors untouched', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'CANCELLED' })
      );

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).message).toBe('This appointment has been cancelled.');
    });

    it('keeps the payment gate as a 403 with its own message', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ payment: { status: 'PENDING' } })
      );

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toContain('Payment is required');
    });
  });

  // ==========================================================================
  // 4. Join window
  // ==========================================================================
  describe('join window', () => {
    const early = getVideoEarlyJoinMinutes();
    const active = getVideoActiveWindowMinutes();
    const beforeWindow = START_MS - early * MINUTE - MINUTE;
    const afterWindow = START_MS + active * MINUTE + MINUTE;

    it('blocks a patient before the window opens (token) with 403 and the window sentence', async () => {
      mockNow(beforeWindow);
      const { service, provider } = createHarness();

      const error = await captureError(
        service.generateMeetingToken('appt-1', PATIENT_USER, 'patient', USER_INFO, patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toContain(`Join opens ${early} minutes before`);
      expect(provider['generateMeetingToken']).not.toHaveBeenCalled();
    });

    it('blocks a patient before the window opens (start)', async () => {
      mockNow(beforeWindow);
      const { service, provider } = createHarness();

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(provider['startConsultation']).not.toHaveBeenCalled();
    });

    it('blocks a patient after the window has closed', async () => {
      mockNow(afterWindow);
      const { service } = createHarness();

      const error = await captureError(
        service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('lets a patient in once the window opens', async () => {
      mockNow(START_MS - early * MINUTE);
      const { service } = createHarness();

      const token = await service.generateMeetingToken(
        'appt-1',
        PATIENT_USER,
        'patient',
        USER_INFO,
        patientCaller()
      );

      expect(token.token).toBe('meeting-token');
    });

    it('lets a doctor open the room before the window (token and start)', async () => {
      mockNow(beforeWindow);
      const { service } = createHarness();

      const token = await service.generateMeetingToken(
        'appt-1',
        DOCTOR_USER,
        'doctor',
        USER_INFO,
        staffCaller('DOCTOR')
      );
      const session = await service.startConsultation(
        'appt-1',
        DOCTOR_USER,
        'doctor',
        staffCaller('DOCTOR')
      );

      expect(token.token).toBe('meeting-token');
      expect(session.id).toBe('vc-1');
    });

    it.each<[VideoCallerRole, string]>([
      ['receptionist', 'NURSE'],
      ['receptionist', 'RECEPTIONIST'],
      ['clinic_admin', 'CLINIC_ADMIN'],
    ])('lets a %s (%s) start early', async (role, rawRole) => {
      mockNow(beforeWindow);
      const { service } = createHarness();

      const session = await service.startConsultation(
        'appt-1',
        'staff-user',
        role,
        staffCaller(rawRole)
      );

      expect(session.id).toBe('vc-1');
    });

    it('keeps the status endpoint behaviour: reports canJoin=false before the window', async () => {
      mockNow(beforeWindow);
      const { service } = createHarness();

      const state = await service.getConsultationAccessState('appt-1', {
        userId: PATIENT_USER,
        userRole: 'patient',
      });

      expect(state.canJoin).toBe(false);
      expect(state.joinBlockedReason).toContain('Join opens');
    });
  });

  // ==========================================================================
  // 6/9. Doctor start side effects
  // ==========================================================================
  describe('doctor start side effects', () => {
    it('moves the appointment to IN_PROGRESS and stamps startedAt with a conditional write', async () => {
      const { service, clients, cacheService } = createHarness();

      await service.startConsultation('appt-1', DOCTOR_USER, 'doctor', staffCaller('DOCTOR'));

      expect(clients.appointment['updateMany']).toHaveBeenCalledTimes(1);
      const args = clients.appointment['updateMany']?.mock.calls[0]?.[0] as {
        where: { id: string; clinicId: string; status: { in: string[] } };
        data: { status: string; startedAt?: Date };
      };
      expect(args.where.clinicId).toBe(CLINIC);
      expect(args.where.status.in).toEqual(
        expect.arrayContaining(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'])
      );
      expect(args.data.status).toBe('IN_PROGRESS');
      expect(args.data.startedAt).toBeInstanceOf(Date);
      expect(cacheService['invalidateAppointmentCache']).toHaveBeenCalled();
    });

    it('does not touch the appointment when the doctor starts an already started visit', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS', startedAt: new Date('2026-03-10T04:31:00Z') })
      );

      await service.startConsultation('appt-1', DOCTOR_USER, 'doctor', staffCaller('DOCTOR'));

      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('stamps startedAt for a legacy IN_PROGRESS appointment that never had one, keeping the status', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS', startedAt: null })
      );

      await service.startConsultation('appt-1', DOCTOR_USER, 'doctor', staffCaller('DOCTOR'));

      const args = clients.appointment['updateMany']?.mock.calls[0]?.[0] as {
        data: { startedAt?: Date };
      };
      expect(args.data.startedAt).toBeInstanceOf(Date);
    });

    it('leaves the appointment untouched when a patient starts the call', async () => {
      const { service, clients } = createHarness();

      await service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller());

      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('does not fail a successful start when the status transition write fails', async () => {
      const { service, clients, loggingService } = createHarness();
      clients.appointment['updateMany']?.mockRejectedValue(new Error(RAW_DB_TEXT));

      const session = await service.startConsultation(
        'appt-1',
        DOCTOR_USER,
        'doctor',
        staffCaller('DOCTOR')
      );

      expect(session.id).toBe('vc-1');
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('Failed to mark appointment IN_PROGRESS'),
        'VideoService.startConsultation',
        expect.any(Object)
      );
    });
  });

  // ==========================================================================
  // 8. Rating
  // ==========================================================================
  describe('rateConsultation', () => {
    function arrangeRatingRead(
      clients: ReturnType<typeof createHarness>['clients'],
      appointment: Record<string, unknown>,
      freshMetadata: Record<string, unknown> | null
    ): void {
      // The appointment is loaded (and authorised) BEFORE the lock, then its metadata is re-read
      // inside the lock with a `select`: answer each read as the real database would.
      clients.appointment['findUnique']
        ?.mockReset()
        .mockImplementation((args: { select?: { metadata?: boolean } }) =>
          args.select?.metadata ? { metadata: freshMetadata } : appointment
        );
    }

    it('creates one review and patches only the consultationRating metadata key', async () => {
      const { service, clients, cacheService } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {
        rescheduleCount: 2,
        notes: 'keep me',
      });

      const result = await service.rateConsultation(
        'appt-1',
        PATIENT_USER,
        5,
        '  Great visit  ',
        CLINIC
      );

      expect(result).toEqual({
        success: true,
        rating: 5,
        comment: 'Great visit',
        reviewId: 'review-1',
      });
      expect(clients.review['create']).toHaveBeenCalledTimes(1);
      const updateArgs = clients.appointment['update']?.mock.calls[0]?.[0] as {
        data: { metadata: Record<string, unknown> };
      };
      expect(updateArgs.data.metadata).toMatchObject({
        rescheduleCount: 2,
        notes: 'keep me',
        consultationRating: {
          reviewId: 'review-1',
          rating: 5,
          comment: 'Great visit',
          ratedBy: PATIENT_USER,
        },
      });
      expect(cacheService['releaseLock']).toHaveBeenCalledWith('video:rate:appt-1');
    });

    it('re-reads metadata inside the lock instead of writing back the stale snapshot', async () => {
      const { service, clients } = createHarness();
      // The snapshot taken at the start of the request is outdated...
      arrangeRatingRead(
        clients,
        makeAppointment({ status: 'COMPLETED', metadata: { stale: true } }),
        // ...another writer changed the metadata in the meantime.
        { freshKey: 'fresh' }
      );

      await service.rateConsultation('appt-1', PATIENT_USER, 4, undefined, CLINIC);

      const updateArgs = clients.appointment['update']?.mock.calls[0]?.[0] as {
        data: { metadata: Record<string, unknown> };
      };
      expect(updateArgs.data.metadata).toHaveProperty('freshKey', 'fresh');
      expect(updateArgs.data.metadata).not.toHaveProperty('stale');
    });

    it('updates the existing review on a repeat submission', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {
        consultationRating: { reviewId: 'review-1', rating: 3 },
      });

      const result = await service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, CLINIC);

      expect(clients.review['update']).toHaveBeenCalledTimes(1);
      expect(clients.review['create']).not.toHaveBeenCalled();
      expect(result.reviewId).toBe('review-1');
    });

    it('lets only one of two concurrent submits create a review', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});

      const outcomes = await Promise.allSettled([
        service.rateConsultation('appt-1', PATIENT_USER, 5, 'a', CLINIC),
        service.rateConsultation('appt-1', PATIENT_USER, 4, 'b', CLINIC),
      ]);

      expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = outcomes.find(outcome => outcome.status === 'rejected') as
        PromiseRejectedResult | undefined;
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      expect(clients.review['create']).toHaveBeenCalledTimes(1);
    });

    it('releases the lock even when the submission fails', async () => {
      const { service, clients, cacheService, heldLocks } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});
      clients.review['create']?.mockRejectedValue(new Error('db down'));

      await expect(
        service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, CLINIC)
      ).rejects.toThrow('db down');

      expect(cacheService['releaseLock']).toHaveBeenCalledTimes(1);
      expect(heldLocks.size).toBe(0);
    });

    it('rejects an authorised patient with 409 when the lock is already held, writing nothing', async () => {
      const { service, clients, heldLocks } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});
      heldLocks.add('video:rate:appt-1');

      const error = await captureError(
        service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, CLINIC)
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(clients.review['create']).not.toHaveBeenCalled();
    });

    it('authorises BEFORE taking the lock: a stranger can neither rate nor block the real patient', async () => {
      const { service, clients, cacheService, heldLocks } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});

      const error = await captureError(
        service.rateConsultation('appt-1', FOREIGN_USER, 5, undefined, CLINIC)
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(cacheService['acquireLock']).not.toHaveBeenCalled();
      expect(heldLocks.size).toBe(0);

      // The real patient is not blocked afterwards.
      const result = await service.rateConsultation('appt-1', PATIENT_USER, 4, undefined, CLINIC);
      expect(result.success).toBe(true);
    });

    it('does not take the lock for another clinic either', async () => {
      const { service, clients, cacheService } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});

      const error = await captureError(
        service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, OTHER_CLINIC)
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(cacheService['acquireLock']).not.toHaveBeenCalled();
    });

    it('lets the owner of the family dependent the visit is for rate it', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(
        clients,
        makeAppointment({
          status: 'COMPLETED',
          familyMemberId: 'family-1',
          userId: 'someone-else',
        }),
        {}
      );
      clients.familyMember['findFirst']?.mockResolvedValue({ id: 'family-1' });

      const result = await service.rateConsultation(
        'appt-1',
        'dependent-owner',
        5,
        undefined,
        CLINIC
      );

      expect(result.success).toBe(true);
      expect(clients.review['create']).toHaveBeenCalledTimes(1);
    });

    it('lets the account that booked the visit rate it', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(
        clients,
        makeAppointment({ status: 'COMPLETED', userId: 'booker-user' }),
        {}
      );

      const result = await service.rateConsultation('appt-1', 'booker-user', 5, undefined, CLINIC);

      expect(result.success).toBe(true);
    });

    it('rejects an appointment that is not a video consultation', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED', type: 'IN_PERSON' }), {});

      const error = await captureError(
        service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, CLINIC)
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(clients.review['create']).not.toHaveBeenCalled();
    });

    it('rejects a patient who is not the appointment patient', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'COMPLETED' }), {});

      const error = await captureError(
        service.rateConsultation('appt-1', FOREIGN_USER, 5, undefined, CLINIC)
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(clients.review['create']).not.toHaveBeenCalled();
    });

    it('answers 404 for another clinic and when no clinic is supplied', async () => {
      const first = createHarness();
      arrangeRatingRead(first.clients, makeAppointment({ status: 'COMPLETED' }), {});
      const second = createHarness();
      arrangeRatingRead(second.clients, makeAppointment({ status: 'COMPLETED' }), {});

      const otherClinic = await captureError(
        first.service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, OTHER_CLINIC)
      );
      const noClinic = await captureError(
        second.service.rateConsultation('appt-1', PATIENT_USER, 5, undefined)
      );

      expect(otherClinic).toBeInstanceOf(NotFoundException);
      expect(noClinic).toBeInstanceOf(NotFoundException);
      expect(first.clients.review['create']).not.toHaveBeenCalled();
    });

    it('rejects rating a visit that has not taken place', async () => {
      const { service, clients } = createHarness();
      arrangeRatingRead(clients, makeAppointment({ status: 'CONFIRMED' }), {});

      const error = await captureError(
        service.rateConsultation('appt-1', PATIENT_USER, 5, undefined, CLINIC)
      );

      expect(error).toBeInstanceOf(BadRequestException);
    });
  });
});
