import * as crypto from 'crypto';
import { HttpStatus } from '@nestjs/common';
import type { DatabaseService } from '@infrastructure/database/database.service';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import {
  getVideoConsultationDelegate,
  type VideoConsultationDbModel,
} from '@core/types/video-database.types';
import type { AuditInfo } from '@core/types/database.types';
import type {
  VideoConsultationSession,
  VideoProviderType,
  IVideoProvider,
} from '@core/types/video.types';

type ConsultationFlags = {
  recordingEnabled: boolean;
  screenSharingEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
  autoRecord?: boolean;
  maxParticipants?: number;
};

type JoinData = {
  roomId: string;
  roomName: string;
  meetingUrl: string;
  token: string;
  expiresAt?: Date;
  provider?: VideoProviderType;
};

/** `videoConsultation.upsert`, which the shared delegate type does not expose. */
type VideoConsultationUpsertDelegate = {
  upsert: (args: {
    where: { roomId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<VideoConsultationDbModel>;
};

/** Consultation statuses that must never be moved back to ACTIVE. */
const FINISHED_CONSULTATION_STATUSES: ReadonlySet<string> = new Set<string>([
  'COMPLETED',
  'ENDED',
  'CANCELLED',
]);

const UNIQUE_CONSTRAINT_CODE = 'P2002';

function getVideoConsultationUpsertDelegate(client: object): VideoConsultationUpsertDelegate {
  const delegate: unknown = (client as { videoConsultation?: unknown }).videoConsultation;
  if (
    typeof delegate !== 'object' ||
    delegate === null ||
    typeof (delegate as { upsert?: unknown }).upsert !== 'function'
  ) {
    throw new Error('Prisma client does not have a videoConsultation.upsert delegate');
  }
  return delegate as VideoConsultationUpsertDelegate;
}

/**
 * Prisma P2002 detection that also works when the DatabaseService wrapped the original error
 * (the wrapper keeps the original message text).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code === UNIQUE_CONSTRAINT_CODE) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return message.includes(UNIQUE_CONSTRAINT_CODE) || message.includes('Unique constraint failed');
}

export function buildStableRoomName(
  providerName: string,
  appointmentId: string,
  clinicId: string
): string {
  const suffix = crypto
    .createHash('sha256')
    .update(`${providerName}:${appointmentId}:${clinicId}:healthcare-video`)
    .digest('hex')
    .slice(0, 12);
  return `${providerName}-appointment-${appointmentId}-${suffix}`;
}

export function buildConsultationSession(
  record: VideoConsultationDbModel,
  provider?: VideoProviderType
): VideoConsultationSession {
  const session: VideoConsultationSession = {
    id: record.id,
    appointmentId: record.appointmentId,
    roomId: record.roomId,
    roomName: record.roomId,
    meetingUrl: record.meetingUrl ?? '',
    confirmedSlotIndex: null,
    status: record.status as VideoConsultationSession['status'],
    startTime: record.startTime,
    endTime: record.endTime,
    participants: [],
    recordingEnabled: record.recordingEnabled,
    screenSharingEnabled: record.screenSharingEnabled,
    chatEnabled: record.chatEnabled,
    waitingRoomEnabled: record.waitingRoomEnabled,
  };

  if (provider !== undefined) {
    session.provider = provider;
  }

  return session;
}

export async function upsertConsultationRecord(
  databaseService: DatabaseService,
  appointmentId: string,
  joinData: JoinData,
  flags: ConsultationFlags
): Promise<VideoConsultationDbModel> {
  const appointment = await databaseService.findAppointmentByIdSafe(appointmentId);
  if (!appointment) {
    throw new HealthcareError(
      ErrorCode.DATABASE_RECORD_NOT_FOUND,
      'Appointment not found',
      HttpStatus.NOT_FOUND,
      { appointmentId },
      'VideoProviderHelpers.upsertConsultationRecord'
    );
  }

  const data = {
    appointmentId,
    patientId: appointment.patientId,
    doctorId: appointment.doctorId,
    clinicId: appointment.clinicId,
    roomId: joinData.roomId,
    meetingUrl: joinData.meetingUrl,
    status: 'SCHEDULED',
    recordingEnabled: flags.recordingEnabled,
    screenSharingEnabled: flags.screenSharingEnabled,
    chatEnabled: flags.chatEnabled,
    waitingRoomEnabled: flags.waitingRoomEnabled,
    autoRecord: flags.autoRecord ?? false,
    maxParticipants: flags.maxParticipants ?? 2,
  };
  // Re-issuing a token (e.g. the patient joining after the doctor started the
  // call) must not knock an ACTIVE/COMPLETED consultation back to SCHEDULED.
  const { status: _initialStatus, ...updateData } = data;

  const writeRecord = async (): Promise<VideoConsultationDbModel> =>
    await databaseService.executeHealthcareWrite(
      async client => {
        const delegate = getVideoConsultationDelegate(client);
        const existing = await delegate.findFirst({
          where: { OR: [{ appointmentId }] },
        });

        if (existing) {
          return await delegate.update({
            where: { id: existing.id },
            data: updateData,
          });
        }

        // First join: the doctor and the patient can arrive together. roomId is unique and
        // deterministic per appointment, so an upsert turns the loser of the race into an
        // update instead of a unique-constraint failure (and a 500 for that participant).
        return await getVideoConsultationUpsertDelegate(client).upsert({
          where: { roomId: data.roomId },
          create: data,
          update: updateData,
        });
      },
      {
        userId: appointment.doctor?.userId || appointment.patient?.userId || 'system',
        userRole: 'DOCTOR',
        clinicId: appointment.clinicId,
        operation: 'CREATE_VIDEO_CONSULTATION',
        resourceType: 'VIDEO_CONSULTATION',
        resourceId: appointmentId,
        timestamp: new Date(),
      }
    );

  try {
    return await writeRecord();
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }
    // Another request created the row between our read and write; it exists now, so the retry
    // takes the update path.
    return await writeRecord();
  }
}

function buildSystemAudit(appointmentId: string, operation: string): AuditInfo {
  return {
    userId: 'system',
    userRole: 'system',
    clinicId: '',
    operation,
    resourceType: 'VIDEO_CONSULTATION',
    resourceId: appointmentId,
    timestamp: new Date(),
  };
}

/**
 * Mark the consultation ACTIVE.
 *
 * `startTime` is stamped once (the first start); later starts - the patient joining after the
 * doctor, or a retry - leave it alone. A COMPLETED/ENDED/CANCELLED consultation is returned
 * unchanged rather than being revived.
 */
export async function markConsultationActive(
  databaseService: DatabaseService,
  appointmentId: string
): Promise<VideoConsultationDbModel | null> {
  return await databaseService.executeHealthcareWrite(
    async client => {
      const delegate = getVideoConsultationDelegate(client);
      const consultation = await delegate.findFirst({ where: { OR: [{ appointmentId }] } });
      if (!consultation) {
        return null;
      }
      if (FINISHED_CONSULTATION_STATUSES.has(consultation.status)) {
        return consultation;
      }
      if (consultation.status === 'ACTIVE' && consultation.startTime) {
        return consultation;
      }

      return await delegate.update({
        where: { id: consultation.id },
        data: {
          status: 'ACTIVE',
          startTime: consultation.startTime ?? new Date(),
        },
      });
    },
    buildSystemAudit(appointmentId, 'UPDATE_VIDEO_CONSULTATION')
  );
}

/**
 * Mark the consultation ended. Providers speak 'ENDED'; the DB enum (VideoCallStatus) calls it
 * COMPLETED. Ending twice keeps the original `endTime`.
 */
export async function markConsultationEnded(
  databaseService: DatabaseService,
  appointmentId: string
): Promise<VideoConsultationDbModel | null> {
  return await databaseService.executeHealthcareWrite(
    async client => {
      const delegate = getVideoConsultationDelegate(client);
      const consultation = await delegate.findFirst({ where: { OR: [{ appointmentId }] } });
      if (!consultation) {
        return null;
      }
      if (consultation.status === 'COMPLETED' || consultation.status === 'ENDED') {
        return consultation;
      }

      return await delegate.update({
        where: { id: consultation.id },
        data: { status: 'COMPLETED', endTime: new Date() },
      });
    },
    buildSystemAudit(appointmentId, 'UPDATE_VIDEO_CONSULTATION')
  );
}

export function buildTokenResponse(joinData: JoinData) {
  return {
    token: joinData.token,
    roomName: joinData.roomName,
    roomId: joinData.roomId,
    meetingUrl: joinData.meetingUrl,
    ...(joinData.provider ? { provider: joinData.provider } : {}),
    ...(joinData.expiresAt ? { expiresAt: joinData.expiresAt } : {}),
  };
}

/**
 * Forced termination of a provider room (admin "terminate session").
 *
 * Not every provider can close a room it created, so this is an optional capability next to the
 * shared `IVideoProvider` contract rather than a member of it.
 */

export interface RoomTerminatingVideoProvider extends IVideoProvider {
  /**
   * Close the provider room so everyone in it is disconnected and the room link stops working.
   * Resolves when the room is gone, including when it was already gone; rejects when the provider
   * could not be asked or refused.
   */
  terminateRoom(roomName: string): Promise<void>;
}

export function canTerminateRooms(
  provider: IVideoProvider
): provider is RoomTerminatingVideoProvider {
  return typeof (provider as { terminateRoom?: unknown }).terminateRoom === 'function';
}

/**
 * The provider that owns `roomName` and can close it, if any. Rooms made through
 * `buildStableRoomName` start with the provider's name (`daily-appointment-...`); matching on that
 * keeps a termination request away from a provider that never created the room.
 */
export function findTerminatingProvider(
  providers: readonly IVideoProvider[],
  roomName: string
): RoomTerminatingVideoProvider | undefined {
  for (const provider of providers) {
    if (roomName.startsWith(`${provider.providerName}-`) && canTerminateRooms(provider)) {
      return provider;
    }
  }
  return undefined;
}
