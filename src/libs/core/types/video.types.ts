/**
 * Video Provider Types
 * @module @core/types/video.types
 * @description Types for video conferencing providers (OpenVidu, Jitsi, etc.)
 */

/**
 * Video provider type
 */
export type VideoProviderType = 'openvidu' | 'jitsi';

/**
 * Video consultation session
 */
export interface VideoConsultationSession {
  id: string;
  appointmentId: string;
  roomId: string;
  roomName: string;
  meetingUrl: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';
  startTime: Date | null;
  endTime: Date | null;
  participants: Array<{
    userId: string;
    role: 'HOST' | 'PARTICIPANT';
    joinedAt: Date | null;
  }>;
  recordingEnabled: boolean;
  screenSharingEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
}

/**
 * Video provider token response
 */
export interface VideoTokenResponse {
  token: string;
  roomName: string;
  roomId: string;
  meetingUrl: string;
  roomPassword?: string;
  meetingPassword?: string;
  encryptionKey?: string;
  expiresAt?: Date;
}

/**
 * Video provider configuration
 */
export interface VideoProviderConfig {
  enabled: boolean;
  provider: VideoProviderType;
  openvidu?: {
    url: string;
    secret: string;
    domain: string;
    enabled: boolean;
    webhookEnabled?: boolean;
    webhookEndpoint?: string;
    webhookEvents?: string;
  };
  jitsi?: {
    domain: string;
    baseUrl: string;
    wsUrl: string;
    appId: string;
    appSecret: string;
    enabled: boolean;
    enableRecording: boolean;
    enableWaitingRoom: boolean;
  };
}

/**
 * Video provider interface - abstraction for video conferencing providers
 */
export interface IVideoProvider {
  /**
   * Provider name
   */
  readonly providerName: VideoProviderType;

  /**
   * Check if provider is enabled
   */
  isEnabled(): boolean;

  /**
   * Generate meeting token for video consultation
   */
  generateMeetingToken(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin',
    userInfo: {
      displayName: string;
      email: string;
      avatar?: string;
    }
  ): Promise<VideoTokenResponse>;

  /**
   * Start consultation session
   */
  startConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession>;

  /**
   * End consultation session
   */
  endConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor' | 'receptionist' | 'clinic_admin'
  ): Promise<VideoConsultationSession>;

  /**
   * Get consultation session
   */
  getConsultationSession(appointmentId: string): Promise<VideoConsultationSession | null>;

  /**
   * Check if provider is healthy
   */
  isHealthy(): Promise<boolean>;
}

/**
 * OpenVidu room configuration
 */
export interface OpenViduRoomConfig {
  id: string;
  name: string;
  createdAt: number;
  customSessionId?: string;
  mediaMode?: 'ROUTED' | 'RELAYED';
  recordingMode?: 'ALWAYS' | 'MANUAL';
  defaultRecordingProperties?: {
    name?: string;
    hasAudio?: boolean;
    hasVideo?: boolean;
    outputMode?: 'COMPOSED' | 'INDIVIDUAL';
    resolution?: string;
    frameRate?: number;
    shmSize?: number;
  };
}

/**
 * Jitsi room configuration (for backward compatibility)
 */
export interface JitsiRoomConfig {
  roomName: string;
  roomPassword?: string;
  meetingPassword?: string;
  moderatorPassword?: string;
  participantPassword?: string;
  encryptionKey?: string;
}

/**
 * OpenVidu webhook event types
 * @see https://docs.openvidu.io/en/stable/developing/webhooks/
 */
export type OpenViduWebhookEvent =
  | 'sessionCreated'
  | 'sessionDestroyed'
  | 'participantJoined'
  | 'participantLeft'
  | 'recordingStarted'
  | 'recordingStopped'
  | 'webrtcConnectionCreated'
  | 'webrtcConnectionDestroyed'
  | 'filterEventDispatched'
  | 'mediaNodeStatusChanged';

/**
 * OpenVidu webhook payload structure
 * @see https://docs.openvidu.io/en/stable/developing/webhooks/
 */
export interface OpenViduWebhookPayload {
  event: OpenViduWebhookEvent;
  sessionId: string;
  timestamp: number;
  participantId?: string;
  connectionId?: string;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Consultation information extracted from video session
 * Used to extract appointment context from video session IDs
 */
export interface ConsultationInfo {
  appointmentId: string;
  clinicId?: string;
  userId?: string;
  userRole?: 'patient' | 'doctor';
}

/**
 * OpenVidu Pro - Recording information
 */
export interface OpenViduRecording {
  id: string;
  sessionId: string;
  name: string;
  outputMode: 'COMPOSED' | 'INDIVIDUAL';
  hasAudio: boolean;
  hasVideo: boolean;
  resolution?: string;
  frameRate?: number;
  status: 'starting' | 'started' | 'stopped' | 'ready' | 'failed';
  createdAt: number;
  size: number;
  duration: number;
  url?: string;
  customLayout?: string;
}

/**
 * OpenVidu Pro - Participant information
 */
export interface OpenViduParticipant {
  id: string;
  connectionId: string;
  sessionId: string;
  createdAt: number;
  location?: string;
  platform?: string;
  serverData?: string;
  clientData?: string;
  role: 'PUBLISHER' | 'SUBSCRIBER' | 'MODERATOR';
  streams: Array<{
    streamId: string;
    hasAudio: boolean;
    hasVideo: boolean;
    audioActive: boolean;
    videoActive: boolean;
    typeOfVideo: 'CAMERA' | 'SCREEN';
    frameRate?: number;
    videoDimensions?: {
      width: number;
      height: number;
    };
  }>;
}

/**
 * OpenVidu Pro - Session analytics
 */
export interface OpenViduSessionAnalytics {
  sessionId: string;
  createdAt: number;
  duration: number;
  numberOfParticipants: number;
  numberOfConnections: number;
  connections: Array<{
    connectionId: string;
    createdAt: number;
    duration: number;
    location?: string;
    platform?: string;
    clientData?: string;
    serverData?: string;
    publishers: number;
    subscribers: number;
  }>;
  recordingCount: number;
  recordingTotalDuration: number;
  recordingTotalSize: number;
}

/**
 * OpenVidu Pro - Network quality metrics
 */
export interface OpenViduNetworkQuality {
  connectionId: string;
  audioStats?: {
    bitrate: number;
    packetsLost: number;
    packetsReceived: number;
    jitter: number;
  };
  videoStats?: {
    bitrate: number;
    packetsLost: number;
    packetsReceived: number;
    jitter: number;
    frameRate: number;
    resolution: {
      width: number;
      height: number;
    };
  };
  networkQuality: 'GOOD' | 'MEDIUM' | 'BAD';
  timestamp: number;
}

/**
 * OpenVidu Pro - Custom layout for recordings
 */
export interface OpenViduCustomLayout {
  layoutId: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
}

/**
 * OpenVidu Pro - Session information with Pro features
 */
export interface OpenViduSessionInfo {
  id: string;
  createdAt: number;
  customSessionId?: string;
  mediaMode: 'ROUTED' | 'RELAYED';
  recordingMode: 'ALWAYS' | 'MANUAL' | 'ON_DEMAND';
  defaultRecordingProperties?: {
    name?: string;
    hasAudio?: boolean;
    hasVideo?: boolean;
    outputMode?: 'COMPOSED' | 'INDIVIDUAL';
    resolution?: string;
    frameRate?: number;
    shmSize?: number;
    customLayout?: string;
  };
  connections: {
    numberOfElements: number;
    content: Array<OpenViduParticipant>;
  };
  recordings: {
    numberOfElements: number;
    content: Array<OpenViduRecording>;
  };
}
