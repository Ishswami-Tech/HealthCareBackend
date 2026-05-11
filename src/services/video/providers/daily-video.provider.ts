import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LogType, LogLevel } from '@core/types';
import { DailyHealthSignalService } from '@services/video/services/daily-health-signal.service';
import type {
  IVideoProvider,
  VideoProviderType,
  VideoTokenResponse,
  VideoConsultationSession,
} from '@core/types/video.types';
import type { VideoProviderConfig } from '@core/types/video.types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import {
  buildStableRoomName,
  buildConsultationSession,
  buildTokenResponse,
  upsertConsultationRecord,
  setConsultationStatus,
} from './video-provider.helpers';

type DailyRoomResponse = {
  name?: string;
  url?: string;
};

type DailyMeetingTokenResponse = {
  token?: string;
};

@Injectable()
export class DailyVideoProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'daily';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => DailyHealthSignalService))
    private readonly dailyHealthSignalService: DailyHealthSignalService
  ) {}

  private getDailyConfig() {
    return this.configService.get<VideoProviderConfig>('video').daily;
  }

  isEnabled(): boolean {
    const config = this.getDailyConfig();
    return config?.enabled === true;
  }

  private buildInternalJoinUrl(appointmentId: string, roomName: string): string {
    const frontendBaseUrl = this.configService.getUrlsConfig().frontend || '';
    const relativeUrl = `/video-appointments/meet/${encodeURIComponent(appointmentId)}?provider=daily&roomName=${encodeURIComponent(roomName)}`;
    return frontendBaseUrl ? `${frontendBaseUrl.replace(/\/+$/, '')}${relativeUrl}` : relativeUrl;
  }

  private buildDailyRoomUrl(roomName: string): string {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    const normalizedDomain = String(config.domain || '')
      .trim()
      .replace(/\/+$/, '');
    if (!normalizedDomain) {
      throw new Error('Daily domain is not configured');
    }

    const baseUrl = /^https?:\/\//i.test(normalizedDomain)
      ? normalizedDomain
      : `https://${normalizedDomain}`;

    return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(roomName)}`;
  }

  private getDailyApiBaseUrl(): string {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    return config.apiBaseUrl.replace(/\/+$/, '');
  }

  private async fetchRoom(roomName: string): Promise<{ roomName: string; roomUrl: string } | null> {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    const response = await fetch(
      `${this.getDailyApiBaseUrl()}/rooms/${encodeURIComponent(roomName)}`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Daily room lookup failed with status ${response.status}`);
    }

    const payload = (await response.json()) as DailyRoomResponse;
    return {
      roomName: payload.name || roomName,
      roomUrl: payload.url || '',
    };
  }

  private async createRoom(
    appointmentId: string,
    roomName: string
  ): Promise<{ roomName: string; roomUrl: string }> {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    const existingRoom = await this.fetchRoom(roomName);
    if (existingRoom) {
      return existingRoom;
    }

    const response = await fetch(`${this.getDailyApiBaseUrl()}/rooms`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: roomName,
        privacy: config.privacy,
        properties: {
          exp: Math.floor(Date.now() / 1000) + config.roomDurationMinutes * 60,
          enable_people_ui: true,
          enable_network_ui: true,
          enable_chat: true,
          enable_shared_chat_history: true,
        },
      }),
    });

    if (!response.ok) {
      const fallbackRoom = await this.fetchRoom(roomName).catch(() => null);
      if (fallbackRoom) {
        return fallbackRoom;
      }
      throw new Error(`Daily room create failed with status ${response.status}`);
    }

    const payload = (await response.json()) as DailyRoomResponse;
    const roomUrl = payload.url || this.buildDailyRoomUrl(roomName);
    return { roomName: payload.name || roomName, roomUrl };
  }

  private async createMeetingToken(
    roomName: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    userInfo: { displayName: string; email: string; avatar?: string }
  ): Promise<string> {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    const response = await fetch(`${this.getDailyApiBaseUrl()}/meeting-tokens`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          room_name: roomName,
          exp: Math.floor(Date.now() / 1000) + config.roomDurationMinutes * 60,
          user_name: userInfo.displayName || 'Participant',
          user_id: userId.slice(0, 36),
          is_owner: userRole !== 'patient',
          enable_screenshare: true,
          start_video_off: false,
          start_audio_off: false,
          eject_at_token_exp: true,
          permissions: {
            hasPresence: true,
            canSend: userRole === 'patient' ? ['audio', 'video'] : true,
            canAdmin:
              userRole === 'patient' ? false : ['participants', 'streaming', 'transcription'],
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Daily meeting token create failed with status ${response.status}`);
    }

    const payload = (await response.json()) as DailyMeetingTokenResponse;
    const token = payload.token?.trim();
    if (!token) {
      throw new Error('Daily meeting token response did not include a token');
    }

    return token;
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
        undefined,
        { appointmentId },
        'DailyVideoProvider.generateMeetingToken'
      );
    }

    const roomName = buildStableRoomName(this.providerName, appointmentId, appointment.clinicId);
    const { roomName: resolvedRoomName, roomUrl } = await this.createRoom(appointmentId, roomName);
    const token = await this.createMeetingToken(resolvedRoomName, userId, userRole, userInfo);
    const meetingUrl = roomUrl || this.buildDailyRoomUrl(resolvedRoomName);

    await upsertConsultationRecord(
      this.databaseService,
      appointmentId,
      {
        roomId: resolvedRoomName,
        roomName: resolvedRoomName,
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

    void this.dailyHealthSignalService.recordTokenSuccess({
      roomName: resolvedRoomName,
      meetingUrl,
    });

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Daily room created',
      'DailyVideoProvider.generateMeetingToken',
      {
        appointmentId,
        userRole,
        roomName: resolvedRoomName,
      }
    );

    return buildTokenResponse({
      roomId: resolvedRoomName,
      roomName: resolvedRoomName,
      meetingUrl,
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
    if (!existing) {
      await this.generateMeetingToken(appointmentId, '', 'doctor', {
        displayName: 'Doctor',
        email: '',
      });
    }

    const session = await setConsultationStatus(this.databaseService, appointmentId, 'ACTIVE', {
      startTime: new Date(),
    });
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
    const session = await setConsultationStatus(this.databaseService, appointmentId, 'ENDED', {
      endTime: new Date(),
    });
    if (!session) {
      throw new Error(`Consultation session not found for appointment ${appointmentId}`);
    }
    return buildConsultationSession(session, this.providerName);
  }

  async getConsultationSession(appointmentId: string): Promise<VideoConsultationSession | null> {
    const record = await this.databaseService.executeHealthcareRead(async prisma => {
      const delegate = getVideoConsultationDelegate(prisma);
      return await delegate.findFirst({ where: { OR: [{ appointmentId }] } });
    });
    return record ? buildConsultationSession(record, this.providerName) : null;
  }

  async isHealthy(): Promise<boolean> {
    const config = this.getDailyConfig();
    if (!config?.enabled || !config.apiKey || !config.domain) {
      return false;
    }

    try {
      const signal = await this.dailyHealthSignalService.isHealthy();
      if (signal !== null) {
        return signal;
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Daily health signal unavailable; assuming enabled Daily provider is healthy until a webhook or status-page signal arrives.',
        'DailyVideoProvider.isHealthy',
        {
          provider: this.providerName,
          statusUrl: config.statusUrl,
        }
      );

      return true;
    } catch {
      return config.enabled;
    }
  }
}
