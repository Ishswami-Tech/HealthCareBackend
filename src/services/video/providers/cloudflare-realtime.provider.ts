import { Injectable, Inject, forwardRef, HttpStatus } from '@nestjs/common';
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
  markConsultationActive,
  markConsultationEnded,
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

type CloudflareMeetingRef = {
  meetingId: string;
  meetingUri: string;
};

@Injectable()
export class CloudflareRealtimeProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'cloudflare';
  // Every Cloudflare call is bounded: an unresponsive API must fail the request (and let the
  // provider fallback run) instead of hanging it. Same bound the Daily provider uses.
  private readonly CLOUDFLARE_FETCH_TIMEOUT_MS = 10000;

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.CLOUDFLARE_FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

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

  private getMeetingsBaseUrl(config: {
    apiBaseUrl: string;
    accountId: string;
    appId: string;
  }): string {
    return `${config.apiBaseUrl.replace(/\/+$/, '')}/accounts/${config.accountId}/realtime/kit/${config.appId}/meetings`;
  }

  /**
   * The meeting a previous join already registered for this appointment, if Cloudflare still
   * knows it. Doctor and patient must land in the SAME meeting, so a stored meeting is reused
   * instead of creating (and overwriting it with) a new one on every token request.
   */
  private async findReusableMeeting(appointmentId: string): Promise<CloudflareMeetingRef | null> {
    const config = this.getCloudflareConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloudflare Realtime is not enabled');
    }

    const stored = await this.databaseService.executeHealthcareRead(async prisma => {
      const delegate = getVideoConsultationDelegate(prisma);
      return await delegate.findFirst({ where: { OR: [{ appointmentId }] } });
    });
    if (!stored?.roomId) {
      return null;
    }

    // The stored room may belong to another provider (the clinic switched providers), so
    // confirm Cloudflare knows it. A miss means "create a new meeting", never an error.
    const response = await this.fetchWithTimeout(
      `${this.getMeetingsBaseUrl(config)}/${encodeURIComponent(stored.roomId)}`,
      { headers: { Authorization: `Bearer ${config.apiToken}` } }
    );
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as CloudflareMeetingResponse;
    const meetingId = String(payload.data?.id || '');
    if (!meetingId) {
      return null;
    }
    return {
      meetingId,
      meetingUri: String(payload.data?.meeting_uri || payload.data?.meetingUri || ''),
    };
  }

  private async createMeeting(
    appointmentId: string,
    roomName: string,
    userInfo: { displayName: string; email: string }
  ): Promise<CloudflareMeetingRef> {
    const config = this.getCloudflareConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloudflare Realtime is not enabled');
    }

    const createResponse = await this.fetchWithTimeout(this.getMeetingsBaseUrl(config), {
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
    });

    if (!createResponse.ok) {
      throw new Error(`Cloudflare meeting create failed with status ${createResponse.status}`);
    }

    const meetingPayload = (await createResponse.json()) as CloudflareMeetingResponse;
    const meetingId = String(meetingPayload.data?.id || '');
    if (!meetingId) {
      throw new Error('Cloudflare meeting create response missing meeting id');
    }

    return {
      meetingId,
      meetingUri: String(meetingPayload.data?.meeting_uri || meetingPayload.data?.meetingUri || ''),
    };
  }

  /** Add this caller to the meeting and return their participant token (null if none issued). */
  private async addParticipant(
    meetingId: string,
    participantKey: string,
    userInfo: { displayName: string }
  ): Promise<string | null> {
    const config = this.getCloudflareConfig();
    if (!config || !config.enabled) {
      throw new Error('Cloudflare Realtime is not enabled');
    }

    const participantPreset =
      config.participantPresetName || config.hostPresetName || 'group-call-participant';
    const participantResponse = await this.fetchWithTimeout(
      `${this.getMeetingsBaseUrl(config)}/${encodeURIComponent(meetingId)}/participants`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          custom_participant_id: participantKey,
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
    return participantPayload.data?.token ? String(participantPayload.data.token) : null;
  }

  async generateMeetingToken(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    userInfo: { displayName: string; email: string; avatar?: string }
  ): Promise<VideoTokenResponse> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment) {
      throw new HealthcareError(
        ErrorCode.DATABASE_RECORD_NOT_FOUND,
        `Appointment ${appointmentId} not found`,
        HttpStatus.NOT_FOUND,
        { appointmentId },
        'CloudflareRealtimeProvider.generateMeetingToken'
      );
    }

    const roomName = buildStableRoomName(this.providerName, appointmentId, appointment.clinicId);
    const reusedMeeting = await this.findReusableMeeting(appointmentId);
    const meeting = reusedMeeting ?? (await this.createMeeting(appointmentId, roomName, userInfo));
    const meetingId = meeting.meetingId;
    const internalJoinUrl = this.buildInternalJoinUrl(appointmentId, meetingId, roomName);
    const meetingUri = meeting.meetingUri || internalJoinUrl;

    // One participant identity per user: doctor and patient must not share an identity.
    const participantToken = await this.addParticipant(
      meetingId,
      userId || appointmentId,
      userInfo
    );
    const token = participantToken || meetingUri;

    await upsertConsultationRecord(
      this.databaseService,
      appointmentId,
      {
        roomId: meetingId,
        roomName,
        meetingUrl: internalJoinUrl,
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
      reusedMeeting ? 'Cloudflare Realtime meeting reused' : 'Cloudflare Realtime meeting created',
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
      meetingUrl: meetingUri,
      token,
      provider: this.providerName,
    });
  }

  async startConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    const existing = await this.getConsultationSession(appointmentId);
    if (!existing) {
      // Creates the meeting + VideoConsultation row for the real caller.
      await this.generateMeetingToken(appointmentId, userId, userRole, {
        displayName: userRole === 'patient' ? 'Patient' : 'Doctor',
        email: '',
      });
    }

    // startTime is stamped once; a repeat start never resets it or revives a finished call.
    const session = await markConsultationActive(this.databaseService, appointmentId);
    if (!session) {
      throw new Error(`Failed to start consultation for appointment ${appointmentId}`);
    }
    return buildConsultationSession(session, this.providerName);
  }

  async endConsultation(
    appointmentId: string,
    _userId: string,
    _userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    const ended = await markConsultationEnded(this.databaseService, appointmentId);
    if (!ended) {
      throw new HealthcareError(
        ErrorCode.DATABASE_RECORD_NOT_FOUND,
        `Consultation session not found for appointment ${appointmentId}`,
        HttpStatus.NOT_FOUND,
        { appointmentId },
        'CloudflareRealtimeProvider.endConsultation'
      );
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
      const response = await this.fetchWithTimeout(
        `${this.getMeetingsBaseUrl(config)}?per_page=1`,
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
