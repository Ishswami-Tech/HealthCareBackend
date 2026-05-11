import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
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
import { getVideoConsultationDelegate } from '@core/types/video-database.types';
import {
  buildStableRoomName,
  buildConsultationSession,
  buildTokenResponse,
  upsertConsultationRecord,
  setConsultationStatus,
} from './video-provider.helpers';

type GoogleMeetSpaceResponse = {
  name?: string;
  meetingUri?: string;
  meetingCode?: string;
};

@Injectable()
export class GoogleMeetProvider implements IVideoProvider {
  readonly providerName: VideoProviderType = 'google-meet';

  constructor(
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  private getGoogleMeetConfig() {
    return this.configService.get<VideoProviderConfig>('video').googleMeet;
  }

  isEnabled(): boolean {
    const config = this.getGoogleMeetConfig();
    return config?.enabled === true;
  }

  private buildOAuthClient() {
    const config = this.getGoogleMeetConfig();
    if (!config) {
      throw new Error('Google Meet is not configured');
    }

    const client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri || undefined
    );
    client.setCredentials({
      refresh_token: config.refreshToken,
    });
    return client;
  }

  private async createSpace(
    appointmentId: string,
    roomName: string
  ): Promise<{ roomId: string; roomName: string; meetingUrl: string; token: string }> {
    const config = this.getGoogleMeetConfig();
    if (!config || !config.enabled) {
      throw new Error('Google Meet is not enabled');
    }

    const client = this.buildOAuthClient();
    const accessToken = await client.getAccessToken();
    const token = accessToken?.token || '';
    if (!token) {
      throw new Error('Unable to obtain Google Meet access token');
    }

    const response = await fetch(`${config.apiBaseUrl.replace(/\/+$/, '')}/spaces`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Google Meet space create failed with status ${response.status}`);
    }

    const payload = (await response.json()) as GoogleMeetSpaceResponse;
    const roomId = String(payload.name || roomName);
    const meetingUrl = String(payload.meetingUri || '');
    if (!meetingUrl) {
      throw new Error('Google Meet create response missing meetingUri');
    }

    return {
      roomId,
      roomName: roomName,
      meetingUrl,
      token: meetingUrl,
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
        'GoogleMeetProvider.generateMeetingToken'
      );
    }

    const roomName = buildStableRoomName(this.providerName, appointmentId, appointment.clinicId);
    const joinData = await this.createSpace(appointmentId, roomName);

    await upsertConsultationRecord(
      this.databaseService,
      appointmentId,
      {
        roomId: joinData.roomId,
        roomName: joinData.roomName,
        meetingUrl: joinData.meetingUrl,
        token: joinData.token,
        provider: this.providerName,
      },
      {
        recordingEnabled: false,
        screenSharingEnabled: true,
        chatEnabled: false,
        waitingRoomEnabled: true,
        autoRecord: false,
        maxParticipants: 2,
      }
    );

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Google Meet space created',
      'GoogleMeetProvider.generateMeetingToken',
      {
        appointmentId,
        userRole,
        meetingUrl: joinData.meetingUrl,
        displayName: userInfo.displayName,
      }
    );

    return buildTokenResponse({
      roomId: joinData.roomId,
      roomName: joinData.roomName,
      meetingUrl: joinData.meetingUrl,
      token: joinData.token,
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
    const config = this.getGoogleMeetConfig();
    if (!config?.enabled || !config.clientId || !config.clientSecret || !config.refreshToken) {
      return false;
    }

    try {
      const client = this.buildOAuthClient();
      const token = await client.getAccessToken();
      return Boolean(token?.token);
    } catch {
      return false;
    }
  }
}
