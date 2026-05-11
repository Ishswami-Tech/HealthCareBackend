import * as crypto from 'crypto';
import type { DatabaseService } from '@infrastructure/database/database.service';
import {
  getVideoConsultationDelegate,
  type VideoConsultationDbModel,
} from '@core/types/video-database.types';
import type { VideoConsultationSession, VideoProviderType } from '@core/types/video.types';

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
    throw new Error(`Appointment ${appointmentId} not found`);
  }

  return await databaseService.executeHealthcareWrite(
    async client => {
      const delegate = getVideoConsultationDelegate(client);
      const existing = await delegate.findFirst({
        where: { OR: [{ appointmentId }] },
      });

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

      if (existing) {
        return await delegate.update({
          where: { id: existing.id },
          data,
        });
      }

      return await delegate.create({ data });
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
}

export async function setConsultationStatus(
  databaseService: DatabaseService,
  appointmentId: string,
  status: VideoConsultationDbModel['status'],
  patch?: Partial<
    Pick<
      VideoConsultationDbModel,
      'startTime' | 'endTime' | 'duration' | 'recordingUrl' | 'isRecording' | 'recordingId'
    >
  >
): Promise<VideoConsultationDbModel | null> {
  return await databaseService.executeHealthcareWrite(
    async client => {
      const delegate = getVideoConsultationDelegate(client);
      const consultation = await delegate.findFirst({
        where: { OR: [{ appointmentId }] },
      });
      if (!consultation) {
        return null;
      }

      return await delegate.update({
        where: { id: consultation.id },
        data: {
          status,
          ...(patch ?? {}),
        },
      });
    },
    {
      userId: 'system',
      userRole: 'system',
      clinicId: '',
      operation: 'UPDATE_VIDEO_CONSULTATION',
      resourceType: 'VIDEO_CONSULTATION',
      resourceId: appointmentId,
      timestamp: new Date(),
    }
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
