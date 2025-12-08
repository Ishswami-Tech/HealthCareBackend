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
    userRole: 'patient' | 'doctor',
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
    userRole: 'patient' | 'doctor'
  ): Promise<VideoConsultationSession>;

  /**
   * End consultation session
   */
  endConsultation(
    appointmentId: string,
    userId: string,
    userRole: 'patient' | 'doctor'
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
