import { Injectable, Inject, forwardRef, HttpStatus } from '@nestjs/common';
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
  markConsultationActive,
  markConsultationEnded,
  type RoomTerminatingVideoProvider,
} from './video-provider.helpers';

/** Room names are `daily-appointment-<appointmentId UUID>-<12 hex hash>` (see buildStableRoomName). */
const ROOM_NAME_APPOINTMENT_ID_PATTERN =
  /^daily-appointment-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[0-9a-f]{12}$/i;

/** The appointment id inside a Daily room name, or '' when the name is not one of ours. */
export function parseAppointmentIdFromRoomName(roomName: string): string {
  return ROOM_NAME_APPOINTMENT_ID_PATTERN.exec(roomName)?.[1] ?? '';
}

type DailyRoomResponse = {
  name?: string;
  url?: string;
  privacy?: string;
};

type DailyConfig = NonNullable<VideoProviderConfig['daily']>;

/** Upper bound on remembered room names so a long-lived process cannot grow the set forever. */
const MAX_PRIVACY_RECONCILED_ROOMS = 5000;

/**
 * After a failed privacy update (429, timeout, 5xx) the room stays joinable without a token, so
 * the update is retried - but not on every token request, which would hammer a degraded Daily API.
 */
const PRIVACY_RETRY_AFTER_FAILURE_MS = 60_000;

type DailyMeetingTokenResponse = {
  token?: string;
};

@Injectable()
export class DailyVideoProvider implements IVideoProvider, RoomTerminatingVideoProvider {
  readonly providerName: VideoProviderType = 'daily';
  // None of the fetch() calls to the Daily.co API below passed a timeout, so
  // Node's undici fetch has no bound and a slow/degraded Daily API can hang
  // indefinitely. generateMeetingToken() can chain up to 3-4 of these calls
  // sequentially (fetchRoom -> createRoom POST -> fetchRoom fallback ->
  // createMeetingToken), so a single unbounded call could block the whole
  // request for minutes. This bounds each call independently; a timeout
  // rejects the same way a network error already did, so callers/fallback
  // logic are unaffected.
  private readonly DAILY_FETCH_TIMEOUT_MS = 10000;
  private publicRoomWarningLogged = false;
  // Rooms whose privacy update SUCCEEDED in this process. Room names are deterministic per
  // appointment, so an existing room is looked up on every token request; this keeps a successful
  // privacy update to one Daily call per room per process.
  private readonly privacyReconciledRooms = new Set<string>();
  // Rooms whose privacy update FAILED, with the time before which it is not attempted again.
  private readonly privacyRetryNotBefore = new Map<string, number>();
  // Rooms with a privacy update on the wire right now (concurrent token requests share it).
  private readonly privacyUpdatesInFlight = new Set<string>();

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.DAILY_FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

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

  /**
   * Public Daily rooms can be joined by anyone who learns the room URL (meeting tokens only add
   * owner rights). DAILY_PRIVACY defaults to 'private', so this only fires when someone sets
   * DAILY_PRIVACY=public explicitly. It warns - once per process - instead of overriding them.
   */
  private warnIfPublicRoomsInProduction(config: { privacy: 'public' | 'private' }): void {
    if (this.publicRoomWarningLogged || config.privacy !== 'public') {
      return;
    }
    if (!this.configService.isProduction()) {
      return;
    }
    this.publicRoomWarningLogged = true;
    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.WARN,
      "Daily rooms are being created with privacy 'public' in production. Anyone with a room URL can join a consultation without a meeting token. Remove DAILY_PRIVACY=public (private is the default) to require tokens.",
      'DailyVideoProvider.createRoom',
      { privacy: config.privacy }
    );
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

    const response = await this.fetchWithTimeout(
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
    await this.ensureRoomPrivacy(roomName, payload.privacy, config);
    return {
      roomName: payload.name || roomName,
      roomUrl: payload.url || '',
    };
  }

  private rememberPrivacyReconciledRoom(roomName: string): void {
    if (this.privacyReconciledRooms.size >= MAX_PRIVACY_RECONCILED_ROOMS) {
      // Set iterates in insertion order, so the first value is the oldest room.
      const oldest = this.privacyReconciledRooms.values().next();
      if (!oldest.done) {
        this.privacyReconciledRooms.delete(oldest.value);
      }
    }
    this.privacyReconciledRooms.add(roomName);
    this.privacyRetryNotBefore.delete(roomName);
  }

  private rememberPrivacyUpdateFailure(roomName: string): void {
    if (this.privacyRetryNotBefore.size >= MAX_PRIVACY_RECONCILED_ROOMS) {
      // Map iterates in insertion order, so the first key is the oldest failure.
      const oldest = this.privacyRetryNotBefore.keys().next();
      if (!oldest.done) {
        this.privacyRetryNotBefore.delete(oldest.value);
      }
    }
    this.privacyRetryNotBefore.set(roomName, Date.now() + PRIVACY_RETRY_AFTER_FAILURE_MS);
  }

  /** True while a recent failed update means the next attempt has to wait. */
  private isPrivacyUpdateBackedOff(roomName: string): boolean {
    const notBefore = this.privacyRetryNotBefore.get(roomName);
    return notBefore !== undefined && Date.now() < notBefore;
  }

  /**
   * Rooms are looked up by a deterministic name and reused, so a room created while
   * DAILY_PRIVACY was 'public' stays joinable by anyone with its URL. When the configured
   * privacy is 'private' and an existing room reports anything else, switch it to private.
   *
   * Best effort: a room is only remembered as reconciled AFTER Daily accepted the update, so one
   * 429, timeout or 5xx does not leave it public for the rest of the process - a failed update is
   * retried on a later token request once PRIVACY_RETRY_AFTER_FAILURE_MS has passed. It uses the
   * same timeout as every other Daily call and logs a failure instead of throwing: a failed
   * update must never block a patient or doctor from joining. A room is never downgraded to
   * public.
   */
  private async ensureRoomPrivacy(
    roomName: string,
    currentPrivacy: string | undefined,
    config: DailyConfig
  ): Promise<void> {
    if (config.privacy !== 'private' || currentPrivacy === 'private') {
      return;
    }
    if (
      this.privacyReconciledRooms.has(roomName) ||
      this.privacyUpdatesInFlight.has(roomName) ||
      this.isPrivacyUpdateBackedOff(roomName)
    ) {
      return;
    }
    this.privacyUpdatesInFlight.add(roomName);

    try {
      // Only `privacy` is sent: omitting `properties` leaves the room's other settings untouched.
      const response = await this.fetchWithTimeout(
        `${this.getDailyApiBaseUrl()}/rooms/${encodeURIComponent(roomName)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ privacy: 'private' }),
        }
      );

      if (!response.ok) {
        this.rememberPrivacyUpdateFailure(roomName);
        this.logPrivacyUpdateFailure(roomName, currentPrivacy, `status ${response.status}`);
        return;
      }

      this.rememberPrivacyReconciledRoom(roomName);
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Existing Daily room switched to privacy 'private'",
        'DailyVideoProvider.ensureRoomPrivacy',
        { roomName, previousPrivacy: currentPrivacy ?? 'unknown' }
      );
    } catch (error: unknown) {
      this.rememberPrivacyUpdateFailure(roomName);
      this.logPrivacyUpdateFailure(
        roomName,
        currentPrivacy,
        error instanceof Error ? error.message : 'unknown error'
      );
    } finally {
      this.privacyUpdatesInFlight.delete(roomName);
    }
  }

  private logPrivacyUpdateFailure(
    roomName: string,
    currentPrivacy: string | undefined,
    reason: string
  ): void {
    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.WARN,
      `Could not switch existing Daily room to privacy 'private' (${reason}); it stays joinable without a meeting token until a retry succeeds`,
      'DailyVideoProvider.ensureRoomPrivacy',
      { roomName, previousPrivacy: currentPrivacy ?? 'unknown' }
    );
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

    this.warnIfPublicRoomsInProduction(config);

    const response = await this.fetchWithTimeout(`${this.getDailyApiBaseUrl()}/rooms`, {
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

    const response = await this.fetchWithTimeout(`${this.getDailyApiBaseUrl()}/meeting-tokens`, {
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
          ...(userId ? { user_id: userId.slice(0, 36) } : {}),
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
        HttpStatus.NOT_FOUND,
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
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession> {
    const existing = await this.getConsultationSession(appointmentId);
    if (!existing) {
      // Creates the Daily room + VideoConsultation row. Use the real caller so the
      // Daily meeting-token request never carries an empty user_id.
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
    const session = await markConsultationEnded(this.databaseService, appointmentId);
    if (!session) {
      throw new HealthcareError(
        ErrorCode.DATABASE_RECORD_NOT_FOUND,
        `Consultation session not found for appointment ${appointmentId}`,
        HttpStatus.NOT_FOUND,
        { appointmentId },
        'DailyVideoProvider.endConsultation'
      );
    }
    return buildConsultationSession(session, this.providerName);
  }

  /**
   * Delete the Daily room: everyone in it is ejected at once and the room link stops working.
   * A room that Daily no longer knows (404) counts as already terminated. Same 10 second timeout
   * as every other Daily call; a refusal or an outage rejects so the caller can tell the admin.
   */
  async terminateRoom(roomName: string): Promise<void> {
    const config = this.getDailyConfig();
    if (!config || !config.enabled) {
      throw new Error('Daily is not enabled');
    }

    const response = await this.fetchWithTimeout(
      `${this.getDailyApiBaseUrl()}/rooms/${encodeURIComponent(roomName)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Daily room delete failed with status ${response.status}`);
    }

    this.privacyReconciledRooms.delete(roomName);
    this.privacyRetryNotBefore.delete(roomName);
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

  async listActiveSessions(): Promise<VideoConsultationSession[]> {
    const config = this.getDailyConfig();
    if (!config?.enabled || !config.apiKey) {
      return [];
    }

    // Same API base, auth and 10 second timeout as every other Daily REST call.
    const response = await this.fetchWithTimeout(`${this.getDailyApiBaseUrl()}/rooms`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Daily API returned ${response.status} during listActiveSessions`,
        'DailyVideoProvider.listActiveSessions',
        { status: response.status }
      );
      return [];
    }

    const data = (await response.json()) as Record<string, unknown>;
    const rooms: Array<{
      name?: string;
      url?: string;
      config?: { max_participants?: number };
      started_at?: number;
      nbr_connected?: number;
      nbr_idle?: number;
      nbr_present?: number;
      recording?: boolean;
    }> = Array.isArray(data['rooms']) ? (data['rooms'] as Array<Record<string, unknown>>) : [];

    return rooms.map(room => {
      const roomId = room.name || '';
      const extractedAppointmentId = parseAppointmentIdFromRoomName(roomId);

      return {
        id: roomId,
        appointmentId: extractedAppointmentId,
        roomId,
        provider: this.providerName,
        roomName: roomId,
        meetingUrl: room.url || '',
        status: 'ACTIVE',
        startTime: room.started_at ? new Date(room.started_at * 1000) : null,
        endTime: null,
        participants: [],
        recordingEnabled: room.recording === true,
        screenSharingEnabled: true,
        chatEnabled: true,
        waitingRoomEnabled: true,
        participantCount: room.nbr_present ?? room.nbr_connected ?? 0,
        duration: room.started_at
          ? Math.floor((Date.now() - room.started_at * 1000) / 1000)
          : undefined,
        isRecording: room.recording === true,
        maxParticipants: room.config?.max_participants ?? 2,
        startedAt: room.started_at ? new Date(room.started_at * 1000).toISOString() : undefined,
      } as VideoConsultationSession;
    });
  }
}
