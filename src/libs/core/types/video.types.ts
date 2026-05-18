/**
 * Video Provider Types
 * @module @core/types/video.types
 * @description Types for video conferencing providers (Cloudflare, Daily, Google Meet)
 */

/**
 * Video provider type
 */
export type VideoProviderType = 'cloudflare' | 'daily' | 'google-meet';

/**
 * Persisted system-wide video provider setting.
 */
export interface VideoProviderSettingResponse {
  provider: VideoProviderType;
  source: 'database' | 'env';
  updatedAt?: Date | string | null;
}

/**
 * Video consultation session
 */
export interface VideoConsultationSession {
  id: string;
  appointmentId: string;
  roomId: string;
  roomName: string;
  meetingUrl: string;
  provider?: VideoProviderType;
  confirmedSlotIndex?: number | null;
  status: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED' | 'CANCELLED';
  startTime: Date | null;
  endTime: Date | null;
  scheduledStartTime?: Date | null;
  scheduledEndTime?: Date | null;
  paymentRequired?: boolean;
  paymentCompleted?: boolean;
  canJoin?: boolean;
  joinBlockedReason?: string | null;
  joinWindowStart?: Date | null;
  joinWindowEnd?: Date | null;
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
 * Explicit join state for a video consultation.
 */
export interface VideoConsultationAccessState {
  appointmentId: string;
  canJoin: boolean;
  paymentRequired: boolean;
  paymentCompleted: boolean;
  joinBlockedReason: string | null;
  appointmentStatus: string;
  scheduledStartTime: Date | null;
  scheduledEndTime: Date | null;
  joinWindowStart: Date | null;
  joinWindowEnd: Date | null;
}

/**
 * Virtual background settings
 */
export interface VirtualBackgroundSettings {
  consultationId: string;
  userId: string;
  enabled: boolean;
  type: 'blur' | 'image' | 'video' | 'none';
  blurIntensity?: number;
  imageUrl?: string;
  videoUrl?: string;
  customBackgroundId?: string;
}

/**
 * Available background preset
 */
export interface BackgroundPreset {
  id: string;
  name: string;
  type: 'blur' | 'image';
  imageUrl?: string;
  blurIntensity?: number;
  isDefault: boolean;
}

/**
 * Video provider token response
 */
export interface VideoTokenResponse {
  token: string;
  roomName: string;
  roomId: string;
  meetingUrl: string;
  provider?: VideoProviderType;
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
  noShowEnabled: boolean;
  provider: VideoProviderType;
  cloudflare?: {
    accountId: string;
    appId: string;
    apiToken: string;
    apiBaseUrl: string;
    enabled: boolean;
    webhookEnabled?: boolean;
    hostPresetName?: string;
    participantPresetName?: string;
  };
  daily?: {
    apiBaseUrl: string;
    apiKey: string;
    domain: string;
    enabled: boolean;
    webhookEnabled?: boolean;
    statusUrl?: string;
    privacy: 'public' | 'private';
    roomDurationMinutes: number;
  };
  googleMeet?: {
    enabled: boolean;
    apiBaseUrl: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    refreshToken: string;
    oauthScope: string;
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
   * List all active sessions (Super Admin)
   */
  listActiveSessions?(): Promise<VideoConsultationSession[]>;

  /**
   * Check if provider is healthy
   */
  isHealthy(): Promise<boolean>;
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
