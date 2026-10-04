/// <reference types="jest" />
/**
 * VideoService lifecycle fixes from the independent review:
 *
 * - who may end (complete) a visit: the appointment's doctor and a same-clinic CLINIC_ADMIN, with an
 *   audit entry for the admin; everyone else is refused instead of getting a silent "success"
 * - the doctor's start claims the first start in the database and never flips an unpaid visit
 * - a failed `appointment.completed` emit is detected, retried once, recorded and re-announced once
 * - the booking account in patient notifications is never a doctor or other staff
 * - the post-call summary and the rating use the same participant rules as the call itself
 *
 * All collaborators are plain mocks; no database, cache, event bus or provider is touched.
 */

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { LogType } from '@core/types';
import { VideoService } from '@services/video/video.service';
import type { VideoCallerContext } from '@services/video/video-access.helpers';

// VideoService only needs these collaborators as injection tokens (it is built with plain mocks).
// Replacing them keeps the heavy transitive module graphs out of this unit test.
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
  OTHER_CLINIC,
  PATIENT_USER,
  START_MS,
  captureError,
  createHarness,
  makeAppointment,
  mockNow,
  patientCaller,
  staffCaller,
} from './video-service.harness';

type Harness = ReturnType<typeof createHarness>;

const END_FORBIDDEN =
  'Only the treating doctor or a clinic admin can end this consultation. Leave the call instead.';

const doctorEnd = (service: VideoService): Promise<unknown> =>
  service.endConsultation('appt-1', DOCTOR_USER, 'doctor', undefined, staffCaller('DOCTOR'));

const adminEnd = (service: VideoService, caller: VideoCallerContext): Promise<unknown> =>
  service.endConsultation('appt-1', 'admin-user', 'clinic_admin', undefined, caller);

function emittedEvents(eventService: Harness['eventService'], type: string): unknown[][] {
  return eventService.emitEnterprise.mock.calls.filter((call: unknown[]) => call[0] === type);
}

function eventMetadata(
  eventService: Harness['eventService'],
  type: string
): Record<string, unknown> | undefined {
  const envelope = emittedEvents(eventService, type)[0]?.[1] as
    { metadata?: Record<string, unknown> } | undefined;
  return envelope?.metadata;
}

function arrangeInProgress(clients: Harness['clients']): void {
  clients.appointment['findUnique']?.mockResolvedValue(makeAppointment({ status: 'IN_PROGRESS' }));
}

describe('VideoService lifecycle fixes', () => {
  beforeEach(() => {
    // Inside the join window by default.
    mockNow(START_MS);
  });

  // ==========================================================================
  // Who may end (complete) a visit
  // ==========================================================================
  describe('who may end a visit', () => {
    it('lets a CLINIC_ADMIN of the appointment clinic end and complete a started visit', async () => {
      const { service, clients, eventService, databaseService } = createHarness();
      arrangeInProgress(clients);

      const session = (await adminEnd(service, staffCaller('CLINIC_ADMIN'))) as { id: string };

      expect(session.id).toBe('vc-1');
      const args = clients.appointment['updateMany']?.mock.calls[0]?.[0] as {
        where: { id: string; clinicId: string; status: string };
        data: { status: string };
      };
      expect(args.where).toEqual({ id: 'appt-1', clinicId: CLINIC, status: 'IN_PROGRESS' });
      expect(args.data.status).toBe('COMPLETED');
      expect(emittedEvents(eventService, 'video.consultation.ended')).toHaveLength(1);
      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(1);

      // The completion is written under the admin's real identity, never as the doctor.
      const writeAudit = databaseService['executeHealthcareWrite']?.mock.calls[0]?.[1] as {
        userId: string;
        userRole: string;
      };
      expect(writeAudit.userId).toBe('admin-user');
      expect(writeAudit.userRole).toBe('CLINIC_ADMIN');
      const completed = emittedEvents(eventService, 'appointment.completed')[0]?.[1] as {
        payload: { completedBy: string };
      };
      expect(completed.payload.completedBy).toBe('admin-user');
    });

    it('writes an audit log entry with the admin id, role and appointment id', async () => {
      const { service, clients, loggingService } = createHarness();
      arrangeInProgress(clients);

      await adminEnd(service, staffCaller('CLINIC_ADMIN'));

      const audit = loggingService.log.mock.calls.filter(
        (call: unknown[]) => call[0] === LogType.AUDIT
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.[4]).toEqual(
        expect.objectContaining({
          appointmentId: 'appt-1',
          clinicId: CLINIC,
          endedBy: 'admin-user',
          endedByRole: 'CLINIC_ADMIN',
        })
      );
    });

    it('does not write the admin audit entry for a visit the doctor ended', async () => {
      const { service, clients, loggingService } = createHarness();
      arrangeInProgress(clients);

      await doctorEnd(service);

      expect(
        loggingService.log.mock.calls.filter((call: unknown[]) => call[0] === LogType.AUDIT)
      ).toHaveLength(0);
    });

    it('answers 404 to a CLINIC_ADMIN of another clinic and ends nothing', async () => {
      const { service, clients, provider, eventService } = createHarness();
      arrangeInProgress(clients);

      const error = await captureError(
        adminEnd(service, staffCaller('CLINIC_ADMIN', OTHER_CLINIC))
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(provider['endConsultation']).not.toHaveBeenCalled();
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      expect(eventService.emitEnterprise).not.toHaveBeenCalled();
    });

    it('does not let a CLINIC_ADMIN complete a visit that never started', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'CONFIRMED' })
      );

      const error = await captureError(adminEnd(service, staffCaller('CLINIC_ADMIN')));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('This consultation has not started');
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('refuses a SUPER_ADMIN on the end route: they terminate sessions instead', async () => {
      const { service, clients, provider } = createHarness();
      arrangeInProgress(clients);

      const error = await captureError(adminEnd(service, { rawRole: 'SUPER_ADMIN' }));

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(END_FORBIDDEN);
      expect(provider['endConsultation']).not.toHaveBeenCalled();
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('lets an ASSISTANT_DOCTOR join but not complete the visit', async () => {
      const { service, clients, provider } = createHarness();
      arrangeInProgress(clients);

      const joined = await service.startConsultation(
        'appt-1',
        'assistant-user',
        'doctor',
        staffCaller('ASSISTANT_DOCTOR')
      );
      expect(joined.id).toBe('vc-1');
      // Joining moved the visit to IN_PROGRESS; what follows must not complete it.
      clients.appointment['updateMany']?.mockClear();

      const error = await captureError(
        service.endConsultation(
          'appt-1',
          'assistant-user',
          'doctor',
          undefined,
          staffCaller('ASSISTANT_DOCTOR')
        )
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe(END_FORBIDDEN);
      expect(provider['endConsultation']).not.toHaveBeenCalled();
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('refuses a therapist who is not the appointment doctor', async () => {
      const { service, clients } = createHarness();
      arrangeInProgress(clients);

      const error = await captureError(
        service.endConsultation(
          'appt-1',
          'other-therapist',
          'doctor',
          undefined,
          staffCaller('THERAPIST')
        )
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('still lets a patient leave through the end route (200, nothing completed)', async () => {
      const { service, clients, eventService } = createHarness();
      arrangeInProgress(clients);

      const session = await service.endConsultation(
        'appt-1',
        PATIENT_USER,
        'patient',
        undefined,
        patientCaller()
      );

      expect(session.id).toBe('vc-1');
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      expect(emittedEvents(eventService, 'video.consultation.participant.left')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Doctor start: payment guard and the first-start claim
  // ==========================================================================
  describe('doctor start', () => {
    const doctorStart = (service: VideoService): Promise<unknown> =>
      service.startConsultation('appt-1', DOCTOR_USER, 'doctor', staffCaller('DOCTOR'));

    it('lets the doctor into the room of an unpaid visit but never flips its status', async () => {
      const { service, clients, eventService, provider } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ payment: { status: 'PENDING' } })
      );

      const session = (await doctorStart(service)) as { id: string };

      expect(session.id).toBe('vc-1');
      expect(provider['startConsultation']).toHaveBeenCalledTimes(1);
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      // Nothing started, so nobody is told the doctor has joined.
      expect(eventMetadata(eventService, 'video.consultation.started')).toMatchObject({
        firstStart: false,
      });
    });

    it('treats a visit with no payment record as unpaid', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(makeAppointment({ payment: null }));

      await doctorStart(service);

      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('claims the first start with a write conditional on startedAt being null', async () => {
      const { service, clients, eventService } = createHarness();

      await doctorStart(service);

      const args = clients.appointment['updateMany']?.mock.calls[0]?.[0] as {
        where: { startedAt: null; clinicId: string };
        data: { status: string; startedAt: Date };
      };
      expect(args.where.startedAt).toBeNull();
      expect(args.where.clinicId).toBe(CLINIC);
      expect(args.data.status).toBe('IN_PROGRESS');
      expect(args.data.startedAt).toBeInstanceOf(Date);
      expect(eventMetadata(eventService, 'video.consultation.started')).toMatchObject({
        actorRole: 'doctor',
        firstStart: true,
      });
    });

    it('tells the patient once when two devices (or a double tap) start at the same moment', async () => {
      const { service, clients, eventService } = createHarness();
      // The database decides: only the first conditional stamp matches.
      let stamped = false;
      clients.appointment['updateMany']?.mockImplementation(async () => {
        if (stamped) {
          return { count: 0 };
        }
        stamped = true;
        return { count: 1 };
      });

      await Promise.all([doctorStart(service), doctorStart(service)]);

      const firstStarts = emittedEvents(eventService, 'video.consultation.started').filter(
        call => (call[1] as { metadata: { firstStart: boolean } }).metadata.firstStart
      );
      expect(firstStarts).toHaveLength(1);
      expect(emittedEvents(eventService, 'video.consultation.started')).toHaveLength(2);
    });

    it('does not claim a first start for a rejoin of a started visit', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS', startedAt: new Date('2026-03-10T04:31:00Z') })
      );

      await doctorStart(service);

      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      expect(eventMetadata(eventService, 'video.consultation.started')).toMatchObject({
        firstStart: false,
      });
    });

    it('does not re-notify on every rejoin when the stamp write fails', async () => {
      const { service, clients, eventService } = createHarness();
      clients.appointment['updateMany']?.mockRejectedValue(new Error('db down'));

      const session = (await doctorStart(service)) as { id: string };
      await doctorStart(service);

      expect(session.id).toBe('vc-1');
      for (const call of emittedEvents(eventService, 'video.consultation.started')) {
        expect((call[1] as { metadata: { firstStart: boolean } }).metadata.firstStart).toBe(false);
      }
    });

    it('does not claim a first start when a patient opens the room', async () => {
      const { service, clients, eventService } = createHarness();

      await service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller());

      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
      expect(eventMetadata(eventService, 'video.consultation.started')).toMatchObject({
        actorRole: 'patient',
        firstStart: false,
      });
    });
  });

  // ==========================================================================
  // appointment.completed: result checked, retried once, recorded, re-announced once
  // ==========================================================================
  describe('appointment.completed announcement', () => {
    interface MetadataStore {
      metadata: Record<string, unknown>;
    }

    /** A COMPLETED appointment whose metadata lives in a store the fake database reads and writes. */
    function arrangeMetadataStore(
      clients: Harness['clients'],
      status: string,
      metadata: Record<string, unknown>
    ): MetadataStore {
      const store: MetadataStore = { metadata };
      clients.appointment['findUnique']?.mockImplementation((args: { select?: unknown }) =>
        args.select
          ? { metadata: store.metadata }
          : makeAppointment({
              status,
              completedAt: new Date('2026-03-10T05:00:00Z'),
              metadata: store.metadata,
            })
      );
      clients.appointment['updateMany']?.mockImplementation(
        async (args: {
          where: { metadata?: unknown };
          data: { metadata?: Record<string, unknown> };
        }) => {
          if (!args.data.metadata) {
            return { count: 1 };
          }
          if (args.where.metadata && store.metadata['completionEventPending'] !== true) {
            return { count: 0 };
          }
          store.metadata = args.data.metadata;
          return { count: 1 };
        }
      );
      return store;
    }

    function failCompletedEmits(eventService: Harness['eventService'], times: number): void {
      let remaining = times;
      eventService.emitEnterprise.mockImplementation(async (type: string) => {
        if (type === 'appointment.completed' && remaining > 0) {
          remaining -= 1;
          return { success: false, eventId: 'evt-x', error: { message: 'bus down' } };
        }
        return { success: true, eventId: 'evt-ok' };
      });
    }

    it('retries once when the event service reports a failed emit, without a marker', async () => {
      const { service, clients, eventService } = createHarness();
      const store = arrangeMetadataStore(clients, 'IN_PROGRESS', {});
      failCompletedEmits(eventService, 1);

      await doctorEnd(service);

      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(2);
      expect(store.metadata).toEqual({});
    });

    it('records a completionEventPending marker when both attempts fail, and still succeeds', async () => {
      const { service, clients, eventService, loggingService } = createHarness();
      const store = arrangeMetadataStore(clients, 'IN_PROGRESS', { rating: { stars: 5 } });
      failCompletedEmits(eventService, 2);

      const session = (await doctorEnd(service)) as { id: string };

      expect(session.id).toBe('vc-1');
      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(2);
      // Only the one key is merged; the rest of the metadata stays.
      expect(store.metadata).toEqual({ rating: { stars: 5 }, completionEventPending: true });
      const markerWrite = clients.appointment['updateMany']?.mock.calls.find(
        (call: unknown[]) => (call[0] as { data: { metadata?: unknown } }).data.metadata
      )?.[0] as { where: { status: string; clinicId: string } };
      expect(markerWrite.where).toMatchObject({ status: 'COMPLETED', clinicId: CLINIC });
      expect(loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('Failed to emit appointment.completed'),
        'VideoService.emitAppointmentCompleted',
        expect.any(Object)
      );
      // The patient-facing ended event does not depend on it.
      expect(emittedEvents(eventService, 'video.consultation.ended')).toHaveLength(1);
    });

    it('treats an emit that throws like a reported failure', async () => {
      const { service, clients, eventService } = createHarness();
      const store = arrangeMetadataStore(clients, 'IN_PROGRESS', {});
      eventService.emitEnterprise.mockImplementation(async (type: string) => {
        if (type === 'appointment.completed') {
          throw new Error('boom');
        }
        return { success: true };
      });

      await doctorEnd(service);

      expect(store.metadata).toEqual({ completionEventPending: true });
    });

    it('re-announces a pending completion exactly once on the next end and clears the marker', async () => {
      const { service, clients, eventService } = createHarness();
      const store = arrangeMetadataStore(clients, 'COMPLETED', {
        keep: 'me',
        completionEventPending: true,
      });

      const first = (await doctorEnd(service)) as { id: string };
      const second = (await doctorEnd(service)) as { id: string };

      expect(first.id).toBe('vc-1');
      expect(second.id).toBe('vc-1');
      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(1);
      expect(store.metadata).toEqual({ keep: 'me' });
      // The idempotent responses never repeat the patient-facing event.
      expect(emittedEvents(eventService, 'video.consultation.ended')).toHaveLength(0);
    });

    it('lets only one of two concurrent end requests re-announce', async () => {
      const { service, clients, eventService } = createHarness();
      arrangeMetadataStore(clients, 'COMPLETED', { completionEventPending: true });

      await Promise.all([doctorEnd(service), doctorEnd(service)]);

      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(1);
    });

    it('puts the marker back when the re-announcement fails again', async () => {
      const { service, clients, eventService } = createHarness();
      const store = arrangeMetadataStore(clients, 'COMPLETED', { completionEventPending: true });
      failCompletedEmits(eventService, 2);

      await doctorEnd(service);

      expect(store.metadata).toEqual({ completionEventPending: true });
    });

    it('announces nothing for an already completed visit without a marker', async () => {
      const { service, clients, eventService } = createHarness();
      arrangeMetadataStore(clients, 'COMPLETED', { keep: 'me' });

      await doctorEnd(service);

      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(0);
      expect(clients.appointment['updateMany']).not.toHaveBeenCalled();
    });

    it('does not let a stranger trigger the re-announcement', async () => {
      const { service, clients, eventService } = createHarness();
      arrangeMetadataStore(clients, 'COMPLETED', { completionEventPending: true });

      const error = await captureError(
        service.endConsultation('appt-1', FOREIGN_USER, 'patient', undefined, patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(emittedEvents(eventService, 'appointment.completed')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Booking account in patient notifications
  // ==========================================================================
  describe('booking account in notifications', () => {
    const END_WITH_BOOKER = { status: 'IN_PROGRESS', userId: 'booker-user' };

    async function endedMetadata(
      harness: Harness,
      overrides: Record<string, unknown> = END_WITH_BOOKER
    ): Promise<Record<string, unknown> | undefined> {
      harness.clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ status: 'IN_PROGRESS', ...overrides })
      );
      await doctorEnd(harness.service);
      return eventMetadata(harness.eventService, 'video.consultation.ended');
    }

    it.each(['RECEPTIONIST', 'NURSE', 'CLINIC_ADMIN', 'DOCTOR', 'ASSISTANT_DOCTOR'])(
      'never includes a booking account with the %s role',
      async role => {
        const harness = createHarness();
        harness.clients.user['findUnique']?.mockResolvedValue({ role });

        const metadata = await endedMetadata(harness);

        expect(metadata).not.toHaveProperty('bookerUserId');
        expect(metadata).toMatchObject({ appointmentId: 'appt-1' });
      }
    );

    it('never includes the treating doctor even when they created the appointment', async () => {
      const harness = createHarness();
      harness.clients.user['findUnique']?.mockResolvedValue({ role: 'PATIENT' });

      const metadata = await endedMetadata(harness, { status: 'IN_PROGRESS', userId: DOCTOR_USER });

      expect(metadata).not.toHaveProperty('bookerUserId');
      // No lookup is needed to know that.
      expect(harness.clients.user['findUnique']).not.toHaveBeenCalled();
    });

    it('includes a booking account that is a PATIENT-role user', async () => {
      const harness = createHarness();
      harness.clients.user['findUnique']?.mockResolvedValue({ role: 'PATIENT' });

      const metadata = await endedMetadata(harness);

      expect(metadata).toMatchObject({ bookerUserId: 'booker-user' });
    });

    it('includes the owner of the family dependent the visit is for', async () => {
      const harness = createHarness();
      harness.clients.familyMember['findFirst']?.mockResolvedValue({ id: 'family-1' });

      const metadata = await endedMetadata(harness, {
        status: 'IN_PROGRESS',
        userId: 'booker-user',
        familyMemberId: 'family-1',
      });

      expect(metadata).toMatchObject({ bookerUserId: 'booker-user' });
    });

    it('skips the lookup when the patient is the one who booked', async () => {
      const harness = createHarness();

      const metadata = await endedMetadata(harness, { status: 'IN_PROGRESS' });

      expect(metadata).not.toHaveProperty('bookerUserId');
      expect(harness.clients.user['findUnique']).not.toHaveBeenCalled();
    });

    it('leaves the booker out, and still ends the visit, when the lookup fails', async () => {
      const harness = createHarness();
      harness.clients.user['findUnique']?.mockRejectedValue(new Error('db down'));

      const metadata = await endedMetadata(harness);

      expect(metadata).not.toHaveProperty('bookerUserId');
      expect(emittedEvents(harness.eventService, 'video.consultation.ended')).toHaveLength(1);
    });

    it('resolves the booker for the started event only on the doctor first start', async () => {
      const harness = createHarness();
      harness.clients.user['findUnique']?.mockResolvedValue({ role: 'PATIENT' });
      harness.clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ userId: 'booker-user' })
      );

      await harness.service.startConsultation(
        'appt-1',
        DOCTOR_USER,
        'doctor',
        staffCaller('DOCTOR')
      );
      const first = eventMetadata(harness.eventService, 'video.consultation.started');
      expect(first).toMatchObject({ firstStart: true, bookerUserId: 'booker-user' });

      // A patient opening the room notifies nobody, so no lookup is made for it.
      harness.clients.user['findUnique']?.mockClear();
      await harness.service.startConsultation('appt-1', PATIENT_USER, 'patient', patientCaller());
      expect(harness.clients.user['findUnique']).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Summary and rating use the participant rules of the call itself
  // ==========================================================================
  describe('getConsultationSummary', () => {
    const summaryFor = (
      service: VideoService,
      userId: string,
      role: Parameters<VideoService['getConsultationSummary']>[2],
      caller: VideoCallerContext
    ): Promise<{ appointmentId: string }> =>
      service.getConsultationSummary('appt-1', userId, role, caller);

    it('shows the summary to the appointment patient', async () => {
      const { service } = createHarness();

      const summary = await summaryFor(service, PATIENT_USER, 'patient', patientCaller());

      expect(summary.appointmentId).toBe('appt-1');
    });

    it('shows it to the owner of the family dependent the visit is for', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ familyMemberId: 'family-1', userId: 'booker-elsewhere' })
      );
      clients.familyMember['findFirst']?.mockResolvedValue({ id: 'family-1' });

      const summary = await summaryFor(service, 'dependent-owner', 'patient', patientCaller());

      expect(summary.appointmentId).toBe('appt-1');
    });

    it('shows it to the account that booked the visit for someone else', async () => {
      const { service, clients } = createHarness();
      clients.appointment['findUnique']?.mockResolvedValue(
        makeAppointment({ userId: 'booker-user', patient: { id: 'patient-1', userId: 'other' } })
      );

      const summary = await summaryFor(service, 'booker-user', 'patient', patientCaller());

      expect(summary.appointmentId).toBe('appt-1');
    });

    it('rejects a foreign patient with 403', async () => {
      const { service } = createHarness();

      const error = await captureError(
        summaryFor(service, FOREIGN_USER, 'patient', patientCaller())
      );

      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('answers 404, not 403, for another clinic', async () => {
      const { service } = createHarness();

      const patient = await captureError(
        summaryFor(service, PATIENT_USER, 'patient', patientCaller(OTHER_CLINIC))
      );
      const admin = await captureError(
        summaryFor(service, 'admin-user', 'clinic_admin', staffCaller('CLINIC_ADMIN', OTHER_CLINIC))
      );
      const doctor = await captureError(
        summaryFor(service, DOCTOR_USER, 'doctor', staffCaller('DOCTOR', OTHER_CLINIC))
      );

      expect(patient).toBeInstanceOf(NotFoundException);
      expect(admin).toBeInstanceOf(NotFoundException);
      expect(doctor).toBeInstanceOf(NotFoundException);
    });

    it('shows it to the appointment doctor, an assistant of the clinic and a clinic admin', async () => {
      const { service } = createHarness();

      await expect(
        summaryFor(service, DOCTOR_USER, 'doctor', staffCaller('DOCTOR'))
      ).resolves.toBeDefined();
      await expect(
        summaryFor(service, 'assistant-user', 'doctor', staffCaller('ASSISTANT_DOCTOR'))
      ).resolves.toBeDefined();
      await expect(
        summaryFor(service, 'admin-user', 'clinic_admin', staffCaller('CLINIC_ADMIN'))
      ).resolves.toBeDefined();
    });

    it('lets a SUPER_ADMIN read any clinic', async () => {
      const { service } = createHarness();

      await expect(
        summaryFor(service, 'root-user', 'clinic_admin', { rawRole: 'SUPER_ADMIN' })
      ).resolves.toBeDefined();
    });
  });
});
