/// <reference types="jest" />
/**
 * VideoController: per-appointment authorisation on every endpoint addressed by an appointment id,
 * a consultation id, a note id or an annotation id.
 *
 * RBAC `video:*` is held by every PATIENT, so it cannot decide who may read or change a given
 * appointment's call. Each of those endpoints must authorise the caller against the appointment
 * (other clinic -> 404, not a participant -> 403) BEFORE it reads or writes anything, and staff-only
 * endpoints must not be open to patients at all.
 *
 * The service is a mock: `authorizeConsultationAccess` is the single decision point (its rules are
 * covered in video-consultation-access.spec.ts); these tests prove the controller calls it first,
 * with the caller's identity, and never reaches a collaborator when it rejects.
 */

import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { VideoController } from '@services/video/video.controller';
import { ROLES_KEY } from '@core/decorators/roles.decorator';
import { CACHE_KEY } from '@core/decorators/cache.decorator';
import { Role } from '@core/types/enums.types';
import { VIDEO_CLINICAL_STAFF_ROLES } from '@services/video/video-access.helpers';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

jest.mock('@dtos', () => ({
  ...jest.requireActual<Record<string, unknown>>('@dtos/video.dto'),
  SuccessResponseDto: jest.requireActual<Record<string, unknown>>('@dtos/common-response.dto')[
    'SuccessResponseDto'
  ],
}));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class RolesGuard {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class ClinicGuard {} }));
jest.mock('@core/guards/profile-completion.guard', () => ({
  ProfileCompletionGuard: class ProfileCompletionGuard {},
}));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class RbacGuard {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@infrastructure/events/event.service', () => ({
  EventService: class EventService {},
}));
jest.mock('@services/video/video.service', () => ({ VideoService: class VideoService {} }));
jest.mock('@services/video/services/video-chat.service', () => ({
  VideoChatService: class VideoChatService {},
}));
jest.mock('@services/video/services/video-waiting-room.service', () => ({
  VideoWaitingRoomService: class VideoWaitingRoomService {},
}));
jest.mock('@services/video/services/video-medical-notes.service', () => ({
  VideoMedicalNotesService: class VideoMedicalNotesService {},
}));
jest.mock('@services/video/services/video-annotation.service', () => ({
  VideoAnnotationService: class VideoAnnotationService {},
}));
jest.mock('@services/video/services/video-transcription.service', () => ({
  VideoTranscriptionService: class VideoTranscriptionService {},
}));
jest.mock('@services/video/services/video-quality.service', () => ({
  VideoQualityService: class VideoQualityService {},
}));
jest.mock('@services/video/services/video-virtual-background.service', () => ({
  VideoVirtualBackgroundService: class VideoVirtualBackgroundService {},
}));

type Deps = ConstructorParameters<typeof VideoController>;

const CLINIC = 'clinic-1';
const USER_ID = 'caller-user';
const APPOINTMENT_ID = '11111111-1111-4111-8111-111111111111';
const CONSULTATION_ID = '22222222-2222-4222-8222-222222222222';
const NOTE_ID = '33333333-3333-4333-8333-333333333333';
const ANNOTATION_ID = '44444444-4444-4444-8444-444444444444';
const SPOOFED_USER = 'someone-else';

function session(): Record<string, unknown> {
  return {
    id: 'vc-1',
    appointmentId: APPOINTMENT_ID,
    roomId: 'room-1',
    roomName: 'room-1',
    meetingUrl: 'https://meet.example/room-1',
    status: 'ACTIVE',
    startTime: null,
    endTime: null,
    participants: [],
    recordingEnabled: false,
    screenSharingEnabled: true,
    chatEnabled: true,
    waitingRoomEnabled: true,
  };
}

function createHarness(): {
  controller: VideoController;
  videoService: Record<string, jest.Mock>;
  chat: Record<string, jest.Mock>;
  waitingRoom: Record<string, jest.Mock>;
  notes: Record<string, jest.Mock>;
  annotations: Record<string, jest.Mock>;
  transcription: Record<string, jest.Mock>;
  quality: Record<string, jest.Mock>;
  virtualBackground: Record<string, jest.Mock>;
  errors: Record<string, jest.Mock>;
  logging: { log: jest.Mock };
  events: { emitEnterprise: jest.Mock };
} {
  const videoService = {
    authorizeConsultationAccess: jest
      .fn()
      .mockResolvedValue({ appointmentId: APPOINTMENT_ID, consultationId: 'vc-1' }),
    getConsultationAccessState: jest.fn().mockResolvedValue({
      canJoin: true,
      paymentRequired: false,
      paymentCompleted: true,
      joinBlockedReason: null,
      joinWindowStart: null,
      joinWindowEnd: null,
      scheduledStartTime: null,
      scheduledEndTime: null,
    }),
    getConsultationSession: jest.fn().mockResolvedValue(session()),
    endConsultation: jest.fn().mockImplementation(async () => session()),
    getConsultationSummary: jest.fn().mockResolvedValue({ appointmentId: APPOINTMENT_ID }),
    terminateConsultation: jest
      .fn()
      .mockResolvedValue({ appointmentId: APPOINTMENT_ID, alreadyEnded: false }),
    reportTechnicalIssue: jest.fn().mockResolvedValue(undefined),
    shareMedicalImage: jest.fn().mockResolvedValue({ data: { imageUrl: 'https://img.example/1' } }),
    startSessionRecording: jest.fn().mockResolvedValue({ recordingId: 'rec-1', status: 'started' }),
    stopSessionRecording: jest.fn().mockResolvedValue({ recordingId: 'rec-1', duration: 3 }),
    getSessionRecordings: jest.fn().mockResolvedValue([]),
    manageSessionParticipant: jest.fn().mockResolvedValue(undefined),
    getSessionParticipants: jest.fn().mockResolvedValue([]),
    getSessionAnalytics: jest.fn().mockResolvedValue({
      sessionId: 'vc-1',
      duration: 0,
      numberOfParticipants: 0,
      numberOfConnections: 0,
      recordingCount: 0,
      recordingTotalDuration: 0,
      recordingTotalSize: 0,
      connections: [],
    }),
    listAllActiveSessions: jest.fn().mockResolvedValue([]),
    getCurrentProvider: jest.fn().mockReturnValue('daily'),
  };
  const chat = {
    sendMessage: jest.fn().mockResolvedValue({ id: 'm1', consultationId: 'vc-1', userId: USER_ID }),
    getMessageHistory: jest.fn().mockResolvedValue([]),
    updateTypingIndicator: jest.fn(),
  };
  const waitingRoom = {
    joinWaitingRoom: jest.fn().mockResolvedValue({ id: 'w1', userId: USER_ID, position: 1 }),
    leaveWaitingRoom: jest.fn().mockResolvedValue(undefined),
    admitPatient: jest.fn().mockResolvedValue({ id: 'w1', userId: 'p', position: 0 }),
    getWaitingRoomQueue: jest.fn().mockResolvedValue([]),
  };
  const notes = {
    getNoteConsultationId: jest.fn().mockResolvedValue(CONSULTATION_ID),
    createNote: jest.fn().mockResolvedValue({ id: 'n1', consultationId: 'vc-1', userId: USER_ID }),
    updateNote: jest.fn().mockResolvedValue({ id: 'n1', consultationId: 'vc-1', userId: USER_ID }),
    getNotes: jest.fn().mockResolvedValue([]),
    saveToEHR: jest.fn().mockResolvedValue({ ehrRecordId: 'ehr-1' }),
  };
  const annotations = {
    getAnnotationConsultationId: jest.fn().mockResolvedValue(CONSULTATION_ID),
    createAnnotation: jest
      .fn()
      .mockResolvedValue({ id: 'a1', consultationId: 'vc-1', userId: USER_ID, data: {} }),
    getAnnotations: jest.fn().mockResolvedValue([]),
    deleteAnnotation: jest.fn().mockResolvedValue(undefined),
  };
  const transcription = {
    createTranscription: jest.fn().mockResolvedValue({ id: 't1' }),
    getTranscript: jest.fn().mockResolvedValue([]),
    searchTranscript: jest.fn().mockResolvedValue([]),
    saveToEHR: jest.fn().mockResolvedValue({ ehrRecordId: 'ehr-2' }),
  };
  const quality = {
    updateQualityMetrics: jest.fn().mockResolvedValue({ id: 'q1' }),
    getQualityMetrics: jest.fn().mockResolvedValue({ id: 'q1' }),
  };
  const virtualBackground = {
    updateBackgroundSettings: jest.fn().mockResolvedValue({ consultationId: 'vc-1' }),
    getBackgroundSettings: jest.fn().mockResolvedValue(null),
  };
  const errors = {
    validationError: jest.fn(() => new ForbiddenException('validation')),
    insufficientPermissions: jest.fn(() => new ForbiddenException('insufficient permissions')),
    internalServerError: jest.fn(() => new Error('internal')),
    notFoundError: jest.fn(() => new NotFoundException('not found')),
    externalServiceInvalidResponse: jest.fn(() => new Error('invalid response')),
    handleError: jest.fn(),
  };

  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const events = { emitEnterprise: jest.fn().mockResolvedValue(undefined) };

  const controller = new VideoController(
    videoService as unknown as Deps[0],
    chat as unknown as Deps[1],
    waitingRoom as unknown as Deps[2],
    notes as unknown as Deps[3],
    annotations as unknown as Deps[4],
    transcription as unknown as Deps[5],
    quality as unknown as Deps[6],
    virtualBackground as unknown as Deps[7],
    logging as unknown as Deps[8],
    events as unknown as Deps[9],
    errors as unknown as Deps[10]
  );

  return {
    controller,
    videoService,
    chat,
    waitingRoom,
    notes,
    annotations,
    transcription,
    quality,
    virtualBackground,
    errors,
    logging,
    events,
  };
}

type Harness = ReturnType<typeof createHarness>;

function makeRequest(
  role: string,
  options: { clinicContextId?: string | undefined; jwtClinicId?: string | undefined } = {}
): ClinicAuthenticatedRequest {
  return {
    user: { id: USER_ID, sub: USER_ID, role, clinicId: options.jwtClinicId },
    clinicContext:
      'clinicContextId' in options
        ? options.clinicContextId === undefined
          ? undefined
          : { clinicId: options.clinicContextId }
        : { clinicId: CLINIC },
  } as unknown as ClinicAuthenticatedRequest;
}

interface EndpointCase {
  name: string;
  /** The id the endpoint authorises: an appointment id or a consultation id. */
  authorizedId: string;
  invoke: (h: Harness, req: ClinicAuthenticatedRequest) => Promise<unknown>;
  /** Collaborators that must stay untouched when authorisation fails. */
  guarded: (h: Harness) => jest.Mock[];
}

const ENDPOINTS: EndpointCase[] = [
  {
    name: 'GET consultation/:appointmentId/status',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) => h.controller.getConsultationStatus(APPOINTMENT_ID, req),
    guarded: h => [
      h.videoService['getConsultationAccessState'] as jest.Mock,
      h.videoService['getConsultationSession'] as jest.Mock,
    ],
  },
  {
    name: 'POST consultation/:appointmentId/report',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) =>
      h.controller.reportTechnicalIssue(
        APPOINTMENT_ID,
        { issueType: 'AUDIO', description: 'no sound' } as never,
        req
      ),
    guarded: h => [h.videoService['reportTechnicalIssue'] as jest.Mock],
  },
  {
    name: 'POST consultation/:appointmentId/share-image',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) =>
      h.controller.shareMedicalImage(APPOINTMENT_ID, { imageData: 'data:image/png' } as never, req),
    guarded: h => [
      h.videoService['getConsultationSession'] as jest.Mock,
      h.videoService['shareMedicalImage'] as jest.Mock,
    ],
  },
  {
    name: 'POST recording/start',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) =>
      h.controller.startRecording({ appointmentId: APPOINTMENT_ID } as never, req),
    guarded: h => [h.videoService['startSessionRecording'] as jest.Mock],
  },
  {
    name: 'POST recording/stop',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) =>
      h.controller.stopRecording(
        { appointmentId: APPOINTMENT_ID, recordingId: 'rec-1' } as never,
        req
      ),
    guarded: h => [h.videoService['stopSessionRecording'] as jest.Mock],
  },
  {
    name: 'GET recording/:appointmentId',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) => h.controller.getRecordings(APPOINTMENT_ID, req),
    guarded: h => [h.videoService['getSessionRecordings'] as jest.Mock],
  },
  {
    name: 'POST participant/manage',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) =>
      h.controller.manageParticipant(
        { appointmentId: APPOINTMENT_ID, connectionId: 'c1', action: 'mute' } as never,
        req
      ),
    guarded: h => [h.videoService['manageSessionParticipant'] as jest.Mock],
  },
  {
    name: 'GET participants/:appointmentId',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) => h.controller.getParticipants(APPOINTMENT_ID, req),
    guarded: h => [h.videoService['getSessionParticipants'] as jest.Mock],
  },
  {
    name: 'GET analytics/:appointmentId',
    authorizedId: APPOINTMENT_ID,
    invoke: (h, req) => h.controller.getSessionAnalytics(APPOINTMENT_ID, req),
    guarded: h => [h.videoService['getSessionAnalytics'] as jest.Mock],
  },
  {
    name: 'POST chat/send',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.sendChatMessage(
        { consultationId: CONSULTATION_ID, message: 'hi', userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.chat['sendMessage'] as jest.Mock],
  },
  {
    name: 'GET chat/:consultationId/history',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getChatHistory(CONSULTATION_ID, req, '10', undefined),
    guarded: h => [h.chat['getMessageHistory'] as jest.Mock],
  },
  {
    name: 'POST chat/typing',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.updateTypingIndicator(
        { consultationId: CONSULTATION_ID, isTyping: true } as never,
        req
      ),
    guarded: h => [h.chat['updateTypingIndicator'] as jest.Mock],
  },
  {
    name: 'POST waiting-room/join',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.joinWaitingRoom(
        { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.waitingRoom['joinWaitingRoom'] as jest.Mock],
  },
  {
    name: 'POST waiting-room/leave',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.leaveWaitingRoom({ consultationId: CONSULTATION_ID } as never, req),
    guarded: h => [h.waitingRoom['leaveWaitingRoom'] as jest.Mock],
  },
  {
    name: 'POST waiting-room/admit',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.admitPatient(
        { consultationId: CONSULTATION_ID, patientId: 'p1', doctorId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.waitingRoom['admitPatient'] as jest.Mock],
  },
  {
    name: 'GET waiting-room/:consultationId/queue',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getWaitingRoomQueue(CONSULTATION_ID, req),
    guarded: h => [h.waitingRoom['getWaitingRoomQueue'] as jest.Mock],
  },
  {
    name: 'POST notes',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.createMedicalNote(
        { consultationId: CONSULTATION_ID, content: 'x', userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.notes['createNote'] as jest.Mock],
  },
  {
    name: 'PATCH notes/:noteId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.updateMedicalNote(NOTE_ID, { content: 'y' } as never, req),
    guarded: h => [h.notes['updateNote'] as jest.Mock],
  },
  {
    name: 'GET notes/:consultationId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getMedicalNotes(CONSULTATION_ID, req),
    guarded: h => [h.notes['getNotes'] as jest.Mock],
  },
  {
    name: 'POST notes/:noteId/save-to-ehr',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.saveNoteToEHR(NOTE_ID, {} as never, req),
    guarded: h => [h.notes['saveToEHR'] as jest.Mock],
  },
  {
    name: 'POST annotations',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.createAnnotation(
        { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.annotations['createAnnotation'] as jest.Mock],
  },
  {
    name: 'GET annotations/:consultationId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getAnnotations(CONSULTATION_ID, req),
    guarded: h => [h.annotations['getAnnotations'] as jest.Mock],
  },
  {
    name: 'DELETE annotations/:annotationId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.deleteAnnotation(ANNOTATION_ID, {} as never, req),
    guarded: h => [h.annotations['deleteAnnotation'] as jest.Mock],
  },
  {
    name: 'POST transcription',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.createTranscription({ consultationId: CONSULTATION_ID } as never, req),
    guarded: h => [h.transcription['createTranscription'] as jest.Mock],
  },
  {
    name: 'GET transcription/:consultationId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getTranscript(CONSULTATION_ID, req),
    guarded: h => [h.transcription['getTranscript'] as jest.Mock],
  },
  {
    name: 'GET transcription/:consultationId/search',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.searchTranscript(CONSULTATION_ID, req, 'pain'),
    guarded: h => [h.transcription['searchTranscript'] as jest.Mock],
  },
  {
    name: 'POST transcription/:consultationId/save-to-ehr',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.saveTranscriptToEHR(CONSULTATION_ID, {} as never, req),
    guarded: h => [h.transcription['saveToEHR'] as jest.Mock],
  },
  {
    name: 'POST quality/update',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.updateQualityMetrics(
        { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.quality['updateQualityMetrics'] as jest.Mock],
  },
  {
    name: 'GET quality/:consultationId/:userId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getQualityMetrics(CONSULTATION_ID, USER_ID, req),
    guarded: h => [h.quality['getQualityMetrics'] as jest.Mock],
  },
  {
    name: 'POST virtual-background',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) =>
      h.controller.updateVirtualBackground(
        { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never,
        req
      ),
    guarded: h => [h.virtualBackground['updateBackgroundSettings'] as jest.Mock],
  },
  {
    name: 'GET virtual-background/:consultationId',
    authorizedId: CONSULTATION_ID,
    invoke: (h, req) => h.controller.getVirtualBackground(CONSULTATION_ID, req),
    guarded: h => [h.virtualBackground['getBackgroundSettings'] as jest.Mock],
  },
];

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('VideoController per-appointment authorisation', () => {
  describe.each(ENDPOINTS)('$name', endpoint => {
    it('authorises the caller against the appointment before touching anything', async () => {
      const h = createHarness();

      await endpoint.invoke(h, makeRequest(Role.PATIENT));

      const authorize = h.videoService['authorizeConsultationAccess'] as jest.Mock;
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(authorize).toHaveBeenCalledWith(endpoint.authorizedId, USER_ID, 'patient', {
        clinicId: CLINIC,
        rawRole: Role.PATIENT,
      });
      const firstGuardedCall = Math.min(
        ...endpoint.guarded(h).map(mock => mock.mock.invocationCallOrder[0] ?? Infinity)
      );
      expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(firstGuardedCall);
    });

    it('answers 403 and reaches no collaborator when the caller is not a participant', async () => {
      const h = createHarness();
      (h.videoService['authorizeConsultationAccess'] as jest.Mock).mockRejectedValue(
        new ForbiddenException('You are not authorized to access this video appointment.')
      );

      const error = await captureError(endpoint.invoke(h, makeRequest(Role.PATIENT)));

      expect(error).toBeInstanceOf(ForbiddenException);
      for (const guarded of endpoint.guarded(h)) {
        expect(guarded).not.toHaveBeenCalled();
      }
    });

    it('answers 404 and reaches no collaborator for an appointment of another clinic', async () => {
      const h = createHarness();
      (h.videoService['authorizeConsultationAccess'] as jest.Mock).mockRejectedValue(
        new NotFoundException('Appointment not found')
      );

      const error = await captureError(endpoint.invoke(h, makeRequest(Role.DOCTOR)));

      expect(error).toBeInstanceOf(NotFoundException);
      for (const guarded of endpoint.guarded(h)) {
        expect(guarded).not.toHaveBeenCalled();
      }
    });

    it('passes the platform role and the validated clinic of the request', async () => {
      const h = createHarness();

      await endpoint.invoke(h, makeRequest(Role.CLINIC_ADMIN, { clinicContextId: 'clinic-9' }));

      expect(h.videoService['authorizeConsultationAccess']).toHaveBeenCalledWith(
        endpoint.authorizedId,
        USER_ID,
        'clinic_admin',
        { clinicId: 'clinic-9', rawRole: Role.CLINIC_ADMIN }
      );
    });
  });

  describe('callers the video layer does not know', () => {
    it.each([Role.PHARMACIST, Role.FINANCE_BILLING, Role.LAB_TECHNICIAN, Role.SUPPORT_STAFF])(
      'answers 403 to a %s without asking the service anything',
      async role => {
        const h = createHarness();

        const error = await captureError(
          h.controller.getConsultationStatus(APPOINTMENT_ID, makeRequest(role))
        );

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(h.videoService['authorizeConsultationAccess']).not.toHaveBeenCalled();
        expect(h.videoService['getConsultationSession']).not.toHaveBeenCalled();
      }
    );
  });

  describe('records addressed by a note or an annotation id', () => {
    it('answers 404 for an unknown note without authorising or writing', async () => {
      const h = createHarness();
      (h.notes['getNoteConsultationId'] as jest.Mock).mockRejectedValue(
        new NotFoundException('Note not found')
      );

      const error = await captureError(
        h.controller.updateMedicalNote(NOTE_ID, { content: 'y' } as never, makeRequest(Role.DOCTOR))
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(h.videoService['authorizeConsultationAccess']).not.toHaveBeenCalled();
      expect(h.notes['updateNote']).not.toHaveBeenCalled();
    });

    it('resolves the note consultation first, then authorises against it', async () => {
      const h = createHarness();

      await h.controller.saveNoteToEHR(NOTE_ID, {} as never, makeRequest(Role.DOCTOR));

      expect(h.notes['getNoteConsultationId']).toHaveBeenCalledWith(NOTE_ID);
      expect(h.videoService['authorizeConsultationAccess']).toHaveBeenCalledWith(
        CONSULTATION_ID,
        USER_ID,
        'doctor',
        { clinicId: CLINIC, rawRole: Role.DOCTOR }
      );
    });

    it('answers 404 for an unknown annotation without deleting anything', async () => {
      const h = createHarness();
      (h.annotations['getAnnotationConsultationId'] as jest.Mock).mockRejectedValue(
        new NotFoundException('Annotation not found')
      );

      const error = await captureError(
        h.controller.deleteAnnotation(ANNOTATION_ID, {} as never, makeRequest(Role.PATIENT))
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(h.annotations['deleteAnnotation']).not.toHaveBeenCalled();
    });
  });

  describe('identity comes from the token, never from the body', () => {
    it('chat: the sender is the authenticated user', async () => {
      const h = createHarness();
      await h.controller.sendChatMessage(
        { consultationId: CONSULTATION_ID, message: 'hi', userId: SPOOFED_USER } as never,
        makeRequest(Role.PATIENT)
      );
      expect(h.chat['sendMessage']).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID })
      );
    });

    it('waiting room: only the authenticated user takes a place in the queue', async () => {
      const h = createHarness();
      await h.controller.joinWaitingRoom(
        { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never,
        makeRequest(Role.PATIENT)
      );
      expect(h.waitingRoom['joinWaitingRoom']).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID })
      );
    });

    it('waiting room: the admitting doctor is the authenticated user', async () => {
      const h = createHarness();
      await h.controller.admitPatient(
        { consultationId: CONSULTATION_ID, patientId: 'p1', doctorId: SPOOFED_USER } as never,
        makeRequest(Role.DOCTOR)
      );
      expect(h.waitingRoom['admitPatient']).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: USER_ID })
      );
    });

    it('notes, annotations, quality and background: the author is the authenticated user', async () => {
      const h = createHarness();
      const req = makeRequest(Role.DOCTOR);
      const body = { consultationId: CONSULTATION_ID, userId: SPOOFED_USER } as never;

      await h.controller.createMedicalNote(body, req);
      await h.controller.createAnnotation(body, req);
      await h.controller.updateQualityMetrics(body, req);
      await h.controller.updateVirtualBackground(body, req);

      for (const mock of [
        h.notes['createNote'],
        h.annotations['createAnnotation'],
        h.quality['updateQualityMetrics'],
        h.virtualBackground['updateBackgroundSettings'],
      ]) {
        expect(mock).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
      }
    });

    it('image sharing: the sharer is the authenticated user', async () => {
      const h = createHarness();
      await h.controller.shareMedicalImage(
        APPOINTMENT_ID,
        { imageData: 'data:image/png', userId: SPOOFED_USER } as never,
        makeRequest(Role.PATIENT)
      );
      expect(h.videoService['shareMedicalImage']).toHaveBeenCalledWith(
        'room-1',
        USER_ID,
        'data:image/png'
      );
    });
  });

  describe('call quality of another participant', () => {
    it('lets a patient read only their own', async () => {
      const h = createHarness();

      const error = await captureError(
        h.controller.getQualityMetrics(CONSULTATION_ID, SPOOFED_USER, makeRequest(Role.PATIENT))
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(h.quality['getQualityMetrics']).not.toHaveBeenCalled();
    });

    it("lets the appointment's staff read any participant's", async () => {
      const h = createHarness();

      await h.controller.getQualityMetrics(CONSULTATION_ID, SPOOFED_USER, makeRequest(Role.DOCTOR));

      expect(h.quality['getQualityMetrics']).toHaveBeenCalledWith(CONSULTATION_ID, SPOOFED_USER);
    });
  });

  describe('status payment reason', () => {
    it('hands the platform role ("PATIENT") to the access state for the payment check', async () => {
      const h = createHarness();

      await h.controller.getConsultationStatus(APPOINTMENT_ID, makeRequest(Role.PATIENT));

      expect(h.videoService['getConsultationAccessState']).toHaveBeenCalledWith(APPOINTMENT_ID, {
        userId: USER_ID,
        userRole: Role.PATIENT,
      });
    });
  });

  describe('admin session list', () => {
    it('lists every clinic for a SUPER_ADMIN', async () => {
      const h = createHarness();

      await h.controller.listAllActiveSessions(
        makeRequest(Role.SUPER_ADMIN, { clinicContextId: undefined })
      );

      expect(h.videoService['listAllActiveSessions']).toHaveBeenCalledWith(undefined);
    });

    it('limits a CLINIC_ADMIN to their own clinic', async () => {
      const h = createHarness();

      await h.controller.listAllActiveSessions(makeRequest(Role.CLINIC_ADMIN));

      expect(h.videoService['listAllActiveSessions']).toHaveBeenCalledWith(CLINIC);
    });

    it('fails closed for a CLINIC_ADMIN without a clinic context', async () => {
      const h = createHarness();

      const error = await captureError(
        h.controller.listAllActiveSessions(
          makeRequest(Role.CLINIC_ADMIN, { clinicContextId: undefined })
        )
      );

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(h.videoService['listAllActiveSessions']).not.toHaveBeenCalled();
    });
  });
});

describe('VideoController lifecycle contracts', () => {
  describe('POST consultation/end', () => {
    it('hands the service the identity and clinic of the token, not of the body', async () => {
      const h = createHarness();

      await h.controller.endConsultation(
        {
          appointmentId: APPOINTMENT_ID,
          userId: SPOOFED_USER,
          userRole: 'doctor',
          meetingNotes: 'notes',
        } as never,
        makeRequest(Role.CLINIC_ADMIN)
      );

      expect(h.videoService['endConsultation']).toHaveBeenCalledWith(
        APPOINTMENT_ID,
        USER_ID,
        'clinic_admin',
        'notes',
        { clinicId: CLINIC, rawRole: Role.CLINIC_ADMIN }
      );
    });

    it('passes the 403 of a role that may not end the visit through to the client', async () => {
      const h = createHarness();
      (h.videoService['endConsultation'] as jest.Mock).mockRejectedValue(
        new ForbiddenException('Only the treating doctor or a clinic admin can end this.')
      );

      const error = await captureError(
        h.controller.endConsultation(
          { appointmentId: APPOINTMENT_ID } as never,
          makeRequest(Role.RECEPTIONIST)
        )
      );

      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('POST transcription', () => {
    it('writes the authenticated caller as the speaker, never the speakerId of the body', async () => {
      const h = createHarness();

      await h.controller.createTranscription(
        {
          consultationId: CONSULTATION_ID,
          transcript: 'Take double the dose',
          speakerId: 'the-doctor',
        } as never,
        makeRequest(Role.DOCTOR)
      );

      expect(h.transcription['createTranscription']).toHaveBeenCalledWith({
        consultationId: CONSULTATION_ID,
        transcript: 'Take double the dose',
        speakerId: USER_ID,
      });
    });

    it('sets the speaker even when the body has none', async () => {
      const h = createHarness();

      await h.controller.createTranscription(
        { consultationId: CONSULTATION_ID, transcript: 'hello' } as never,
        makeRequest(Role.NURSE)
      );

      expect(h.transcription['createTranscription']).toHaveBeenCalledWith(
        expect.objectContaining({ speakerId: USER_ID })
      );
    });
  });

  describe('POST admin/sessions/:id/terminate', () => {
    it('terminates through the service with the caller identity and clinic context', async () => {
      const h = createHarness();

      const result = await h.controller.terminateSession(
        APPOINTMENT_ID,
        makeRequest(Role.CLINIC_ADMIN)
      );

      expect(h.videoService['terminateConsultation']).toHaveBeenCalledWith(
        APPOINTMENT_ID,
        USER_ID,
        { clinicId: CLINIC, rawRole: Role.CLINIC_ADMIN }
      );
      expect(result).toMatchObject({ success: true });
    });

    it('lets a SUPER_ADMIN act without a clinic context', async () => {
      const h = createHarness();

      await h.controller.terminateSession(
        APPOINTMENT_ID,
        makeRequest(Role.SUPER_ADMIN, { clinicContextId: undefined })
      );

      expect(h.videoService['terminateConsultation']).toHaveBeenCalledWith(
        APPOINTMENT_ID,
        USER_ID,
        { clinicId: undefined, rawRole: Role.SUPER_ADMIN }
      );
    });

    it.each([
      ['404', new NotFoundException('Appointment not found')],
      ['403', new ForbiddenException('nope')],
    ])('passes a %s through instead of folding it into a 500', async (_label, failure) => {
      const h = createHarness();
      (h.videoService['terminateConsultation'] as jest.Mock).mockRejectedValue(failure);

      const error = await captureError(
        h.controller.terminateSession(APPOINTMENT_ID, makeRequest(Role.CLINIC_ADMIN))
      );

      expect(error).toBe(failure);
    });

    it('answers an unknown failure with the generic 500', async () => {
      const h = createHarness();
      (h.videoService['terminateConsultation'] as jest.Mock).mockRejectedValue(new Error('boom'));

      const error = await captureError(
        h.controller.terminateSession(APPOINTMENT_ID, makeRequest(Role.SUPER_ADMIN))
      );

      expect((error as Error).message).toBe('internal');
    });
  });

  describe('GET consultation/:appointmentId/summary', () => {
    it.each([
      [Role.PATIENT, 'patient'],
      [Role.DOCTOR, 'doctor'],
      [Role.ASSISTANT_DOCTOR, 'doctor'],
      [Role.CLINIC_ADMIN, 'clinic_admin'],
      [Role.SUPER_ADMIN, 'clinic_admin'],
    ])('authorises a %s as "%s" with the clinic and role of the request', async (role, mapped) => {
      const h = createHarness();

      await h.controller.getConsultationSummary(APPOINTMENT_ID, makeRequest(role));

      expect(h.videoService['getConsultationSummary']).toHaveBeenCalledWith(
        APPOINTMENT_ID,
        USER_ID,
        mapped,
        { clinicId: CLINIC, rawRole: role }
      );
    });

    it('passes the 404 of another clinic through', async () => {
      const h = createHarness();
      (h.videoService['getConsultationSummary'] as jest.Mock).mockRejectedValue(
        new NotFoundException('Appointment not found')
      );

      const error = await captureError(
        h.controller.getConsultationSummary(APPOINTMENT_ID, makeRequest(Role.PATIENT))
      );

      expect(error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('GET consultation/:appointmentId/status catch-all', () => {
    const RAW_DB_TEXT =
      'Invalid prisma.appointment.findUnique() invocation: Cannot reach database server at db.internal.example:5432';

    async function failStatus(h: Harness): Promise<void> {
      (h.videoService['getConsultationAccessState'] as jest.Mock).mockRejectedValue(
        new Error(RAW_DB_TEXT)
      );
      await captureError(
        h.controller.getConsultationStatus(APPOINTMENT_ID, makeRequest(Role.PATIENT))
      );
    }

    it('keeps the raw error text and name out of the exception metadata the client receives', async () => {
      const h = createHarness();

      await failStatus(h);

      expect(h.errors['externalServiceInvalidResponse']).toHaveBeenCalledTimes(1);
      const [, , metadata] = (h.errors['externalServiceInvalidResponse'] as jest.Mock).mock
        .calls[0] as [string, string, Record<string, unknown>];
      expect(metadata).toEqual({ appointmentId: APPOINTMENT_ID, phase: 'catch-all' });
      expect(JSON.stringify(metadata)).not.toContain('internal.example');
    });

    it('still gives the operator the real cause in the log', async () => {
      const h = createHarness();

      await failStatus(h);

      expect(h.logging.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('internal.example'),
        'VideoController.getConsultationStatus',
        expect.objectContaining({ originalErrorName: 'Error' })
      );
    });

    it('keeps the raw text out of the failure event too', async () => {
      const h = createHarness();

      await failStatus(h);

      const failedEvent = (h.events.emitEnterprise as jest.Mock).mock.calls.find(
        (call: unknown[]) => call[0] === 'video.consultation.status.failed'
      );
      expect(failedEvent).toBeDefined();
      expect(JSON.stringify(failedEvent)).not.toContain('internal.example');
    });
  });
});

function rolesOf(handler: keyof VideoController): readonly string[] {
  return (Reflect.getMetadata(ROLES_KEY, VideoController.prototype[handler]) ?? []) as string[];
}

describe('VideoController role restrictions', () => {
  // Staff-only endpoints must not be open to a PATIENT, whatever RBAC `video:*` says.
  const STAFF_ONLY_HANDLERS: Array<keyof VideoController> = [
    'startRecording',
    'stopRecording',
    'getRecordings',
    'manageParticipant',
    'getParticipants',
    'getSessionAnalytics',
    'admitPatient',
    'getWaitingRoomQueue',
    'createMedicalNote',
    'updateMedicalNote',
    'saveNoteToEHR',
    'saveTranscriptToEHR',
    'createTranscription',
    'listAllActiveSessions',
    'terminateSession',
    'getGlobalVideoProviderSetting',
    'updateGlobalVideoProviderSetting',
  ];

  it.each(STAFF_ONLY_HANDLERS)('%s is closed to patients', handler => {
    const roles = rolesOf(handler);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles).not.toContain(Role.PATIENT);
  });

  it.each(['startRecording', 'stopRecording', 'getRecordings', 'manageParticipant'] as const)(
    '%s (moderation) keeps SUPER_ADMIN and excludes front-desk and nursing roles',
    handler => {
      const roles = rolesOf(handler);
      expect(roles).toEqual(
        expect.arrayContaining([Role.DOCTOR, Role.CLINIC_ADMIN, Role.SUPER_ADMIN])
      );
      expect(roles).not.toContain(Role.RECEPTIONIST);
      expect(roles).not.toContain(Role.NURSE);
    }
  );

  it.each(['listAllActiveSessions'] as const)('%s allows only the two admin roles', handler => {
    expect([...rolesOf(handler)].sort()).toEqual([Role.CLINIC_ADMIN, Role.SUPER_ADMIN].sort());
  });

  it.each(['getGlobalVideoProviderSetting', 'updateGlobalVideoProviderSetting'] as const)(
    '%s is SUPER_ADMIN only',
    handler => {
      expect(rolesOf(handler)).toEqual([Role.SUPER_ADMIN]);
    }
  );

  it('terminateSession allows SUPER_ADMIN and CLINIC_ADMIN (the latter only inside their clinic)', () => {
    expect([...rolesOf('terminateSession')].sort()).toEqual(
      [Role.CLINIC_ADMIN, Role.SUPER_ADMIN].sort()
    );
  });

  it('createTranscription is for clinical staff only: the transcript can be saved to the EHR', () => {
    expect([...rolesOf('createTranscription')].sort()).toEqual(
      [...VIDEO_CLINICAL_STAFF_ROLES].sort()
    );
    expect(rolesOf('createTranscription')).not.toContain(Role.PATIENT);
    expect(rolesOf('createTranscription')).not.toContain(Role.RECEPTIONIST);
  });

  it('consultation/end is open to patients (leave), the doctor roles and CLINIC_ADMIN, not SUPER_ADMIN', () => {
    const roles = rolesOf('endConsultation');
    expect(roles).toEqual(
      expect.arrayContaining([Role.PATIENT, Role.DOCTOR, Role.CLINIC_ADMIN, Role.ASSISTANT_DOCTOR])
    );
    expect(roles).not.toContain(Role.SUPER_ADMIN);
  });

  it('keeps participant-facing endpoints open to patients (they are authorised per appointment)', () => {
    for (const handler of [
      'getConsultationStatus',
      'reportTechnicalIssue',
      'shareMedicalImage',
    ] as const) {
      expect(rolesOf(handler)).toContain(Role.PATIENT);
    }
  });
});

describe('VideoController cached reads', () => {
  // A cache hit skips the handler, and with it the participant check, so every cached read of an
  // appointment's call data is keyed per caller.
  it.each([
    'getConsultationStatus',
    'getRecordings',
    'getParticipants',
    'getSessionAnalytics',
  ] as const)('%s keys its cache entry by user', handler => {
    const options = Reflect.getMetadata(CACHE_KEY, VideoController.prototype[handler]) as {
      keyTemplate: string;
    };
    expect(options.keyTemplate).toContain('{userId}');
    expect(options.keyTemplate).toContain('{appointmentId}');
  });
});
