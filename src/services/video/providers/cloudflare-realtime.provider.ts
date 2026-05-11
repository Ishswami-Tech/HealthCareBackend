import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LogType, LogLevel } from '@core/types';
import type {
  IVideoProvider,
  VideoProviderType,
  VideoTokenResponse,
  VideoConsultationSession,
} from '@core/types/video.types';
import type { VideoProviderConfig } from '@core/types/video.types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { VideoConsultationDbModel } from '@core/types/video-database.types';
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import {
  buildStableRoomName,
  buildConsultationSession,
  buildTokenResponse,
  upsertConsultationRecord,
  setConsultationStatus,
} from './video-provider.helpers';

type CloudflareMeetingResponse = {
  data?: {
    id?: string;
    meeting_uri?: string;
    meetingUri?: string;
    meeting_code?: string;
    meetingCode?: string;
  };
  success?: boolean;
};

type CloudflareParticipantResponse = {
  data?: { id?: string; token?: string };
  success?: boolean;
};

@Injectable()
export class CloudflareRealtimeProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'cloudflare';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  isEnabled(): boolean {
    const videoConfig = this.configService.get<VideoProviderConfig>('video');
    return videoConfig?.enabled === true && videoConfig.cloudflare?.enabled === true;
  }

  private getCloudflareConfig() {
    return this.configService.get<VideoProviderConfig>('video').cloudflare;
  }

  private buildInternalJoinUrl(appointmentId: string, meetingId: string, roomName: string): string {
    const frontendBaseUrl = this.configService.getUrlsConfig().frontend || '';
    const relativeUrl = `/video-appointments/meet/${encodeURIComponent(appointmentId)}?provider=cloudflare&meetingId=${encodeURIComponent(meetingId)}&roomName=${encodeURIComponent(roomName)}`;
    return frontendBaseUrl ? `${frontendBaseUrl.replace(/\/+$/, '')}${relativeUrl}` : relativeUrl;
  }

  private async createMeeting(
    appointmentId: string,
    roomName: string,
    userInfo: { displayName: string; email: string }
  ): Promise<{ meetingId: string; meetingUri: string; token: string }> {
    const config = this.getCloudflareConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloudflare Realtime is not enabled');
    }

    const apiBaseUrl = config.apiBaseUrl.replace(/\/+$/, '');
    const createResponse = await fetch(
      `${apiBaseUrl}/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `Appointment ${appointmentId}`,
          metadata: {
            appointmentId,
            roomName,
            createdBy: userInfo.displayName,
            email: userInfo.email,
          },
        }),
      }
    );

    if (!createResponse.ok) {
      throw new Error(`Cloudflare meeting create failed with status ${createResponse.status}`);
    }

    const meetingPayload = (await createResponse.json()) as CloudflareMeetingResponse;
    const meetingId = String(meetingPayload.data?.id || '');
    if (!meetingId) {
      throw new Error('Cloudflare meeting create response missing meeting id');
    }

    const participantPreset =
      config.participantPresetName || config.hostPresetName || 'group-call-participant';
    const participantResponse = await fetch(
      `${apiBaseUrl}/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings/${meetingId}/participants`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          custom_participant_id: appointmentId,
          preset_name: participantPreset,
          name: userInfo.displayName,
        }),
      }
    );

    if (!participantResponse.ok) {
      throw new Error(
        `Cloudflare participant create failed with status ${participantResponse.status}`
      );
    }

    const participantPayload = (await participantResponse.json()) as CloudflareParticipantResponse;
    const meetingUri =
      String(meetingPayload.data?.meeting_uri || meetingPayload.data?.meetingUri || '') ||
      this.buildInternalJoinUrl(appointmentId, meetingId, roomName);
    const token = String(participantPayload.data?.token || meetingUri);

    return {
      meetingId,
      meetingUri: meetingUri || this.buildInternalJoinUrl(appointmentId, meetingId, roomName),
      token,
    };
  }

  async generateMeetingToken(
    appointmentId: string,
    _userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    userInfo: { displayName: string; email: string; avatar?: string }
  ): Promise<VideoTokenResponse> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment) {
      throw new HealthcareError(
        ErrorCode.DATABASE_RECORD_NOT_FOUND,
        `Appointment ${appointmentId} not found`,
        undefined,
        { appointmentId },
        'CloudflareRealtimeProvider.generateMeetingToken'
      );
    }

    const roomName = buildStableRoomName(this.providerName, appointmentId, appointment.clinicId);
    const { meetingId, meetingUri, token } = await this.createMeeting(
      appointmentId,
      roomName,
      userInfo
    );
    const meetingUrl = this.buildInternalJoinUrl(appointmentId, meetingId, roomName);

    await upsertConsultationRecord(
      this.databaseService,
      appointmentId,
      {
        roomId: meetingId,
        roomName,
        meetingUrl,
        token,
        provider: this.providerName,
      },
      {
        recordingEnabled: false,
        screenSharingEnabled: true,
        chatEnabled: true,
        waitingRoomEnabled: true,
        autoRecord: false,
        maxParticipants: 2,
      }
    );

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Cloudflare Realtime meeting created',
      'CloudflareRealtimeProvider.generateMeetingToken',
      {
        appointmentId,
        userRole,
        meetingId,
      }
    );

    return buildTokenResponse({
      roomId: meetingId,
      roomName,
      meetingUrl: meetingUri || meetingUrl,
      token,
      provider: this.providerName,
    });
  }

  async startConsultation(
    appointmentId: string,
    _userId: string,
    _userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    const existing = await this.getConsultationSession(appointmentId);
    if (existing) {
      const session = await setConsultationStatus(this.databaseService, appointmentId, 'ACTIVE', {
        startTime: new Date(),
      });
      if (!session) {
        throw new Error(`Failed to start consultation for appointment ${appointmentId}`);
      }
      return buildConsultationSession(session, this.providerName);
    }

    await this.generateMeetingToken(appointmentId, '', 'doctor', {
      displayName: 'Doctor',
      email: '',
    });
    const session = await this.getConsultationSession(appointmentId);
    if (!session) {
      throw new Error(`Failed to create consultation session for appointment ${appointmentId}`);
    }
    return session;
  }

  async endConsultation(
    appointmentId: string,
    _userId: string,
    _userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    const ended = await setConsultationStatus(this.databaseService, appointmentId, 'ENDED', {
      endTime: new Date(),
    });
    if (!ended) {
      throw new Error(`Consultation session not found for appointment ${appointmentId}`);
    }
    return buildConsultationSession(ended, this.providerName);
  }

  async getConsultationSession(appointmentId: string): Promise<VideoConsultationSession | null> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment) {
      return null;
    }

    const record = await this.databaseService.executeHealthcareRead(async prisma => {
      const delegate = getVideoConsultationDelegate(prisma);
      return await delegate.findFirst({ where: { OR: [{ appointmentId }] } });
    });

    return record
      ? buildConsultationSession(record as VideoConsultationDbModel, this.providerName)
      : null;
  }

  async isHealthy(): Promise<boolean> {
    const config = this.getCloudflareConfig();
    if (!config?.enabled || !config.accountId || !config.appId || !config.apiToken) {
      return false;
    }

    try {
      const response = await fetch(
        `${config.apiBaseUrl.replace(/\/+$/, '')}/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings?per_page=1`,
        {
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
          },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }
}
