/**
 * Video Consultation Data Transfer Objects
 * @module @dtos/video.dto
 * @description DTOs for video consultation operations following appointment.dto.ts pattern
 *
 * @see {@link ./appointment.dto.ts} for shared enums and appointment-related DTOs:
 * - VideoCallStatus enum (reused from appointment.dto.ts)
 * - AppointmentType.VIDEO_CALL for video call appointments
 * - AppointmentResponseDto for appointment data in video contexts
 *
 * Note: StartConsultationDto in appointment.dto.ts is for general consultations.
 * StartVideoConsultationDto here is specifically for video consultations with appointment context.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsNotEmpty,
  IsEmail,
  IsUrl,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  ValidateNested,
  IsObject,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VideoCallStatus } from './appointment.dto';

/**
 * User information for video consultation
 * @class VideoUserInfoDto
 */
export class VideoUserInfoDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'User display name for video consultation',
  })
  @IsString({ message: 'Display name must be a string' })
  @IsNotEmpty({ message: 'Display name is required' })
  displayName!: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'User email address',
  })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: 'User avatar URL',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Avatar must be a valid URL' })
  avatar?: string;
}

/**
 * Data Transfer Object for generating video meeting token
 * @class GenerateVideoTokenDto
 */
export class GenerateVideoTokenDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID joining the consultation',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiProperty({
    example: 'patient',
    description: 'User role in the consultation',
    enum: ['patient', 'doctor'],
  })
  @IsEnum(['patient', 'doctor'], {
    message: 'User role must be either "patient" or "doctor"',
  })
  @IsNotEmpty({ message: 'User role is required' })
  userRole!: 'patient' | 'doctor';

  @ApiProperty({
    description: 'User information for video consultation',
    type: VideoUserInfoDto,
  })
  @ValidateNested()
  @Type(() => VideoUserInfoDto)
  @IsNotEmpty({ message: 'User info is required' })
  userInfo!: VideoUserInfoDto;
}

/**
 * Data Transfer Object for starting video consultation
 * @class StartVideoConsultationDto
 */
export class StartVideoConsultationDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID starting the consultation',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiProperty({
    example: 'patient',
    description: 'User role in the consultation',
    enum: ['patient', 'doctor'],
  })
  @IsEnum(['patient', 'doctor'], {
    message: 'User role must be either "patient" or "doctor"',
  })
  @IsNotEmpty({ message: 'User role is required' })
  userRole!: 'patient' | 'doctor';
}

/**
 * Data Transfer Object for ending video consultation
 * @class EndVideoConsultationDto
 */
export class EndVideoConsultationDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID ending the consultation',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiProperty({
    example: 'patient',
    description: 'User role in the consultation',
    enum: ['patient', 'doctor'],
  })
  @IsEnum(['patient', 'doctor'], {
    message: 'User role must be either "patient" or "doctor"',
  })
  @IsNotEmpty({ message: 'User role is required' })
  userRole!: 'patient' | 'doctor';

  @ApiPropertyOptional({
    example: 'Patient felt better after consultation',
    description: 'Optional meeting notes',
  })
  @IsOptional()
  @IsString({ message: 'Meeting notes must be a string' })
  meetingNotes?: string;
}

/**
 * Data Transfer Object for sharing medical image
 * @class ShareMedicalImageDto
 */
export class ShareMedicalImageDto {
  @ApiProperty({
    example: 'call-uuid-123',
    description: 'Video call ID',
  })
  @IsString({ message: 'Call ID must be a string' })
  @IsNotEmpty({ message: 'Call ID is required' })
  callId!: string;

  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID sharing the image',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiProperty({
    description: 'Medical image data (base64 encoded or URL)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject({ message: 'Image data must be an object' })
  @IsNotEmpty({ message: 'Image data is required' })
  imageData!: Record<string, unknown>;
}

/**
 * Response DTO for sharing medical image
 * @class ShareMedicalImageResponseDto
 */
export class ShareMedicalImageResponseDto {
  @ApiProperty({
    example: 'https://images.example.com/medical/call-123/user-456/1234567890.jpg',
    description: 'URL of the uploaded medical image',
  })
  @IsUrl({}, { message: 'Image URL must be a valid URL' })
  @IsNotEmpty({ message: 'Image URL is required' })
  imageUrl!: string;

  @ApiProperty({
    example: 'call-uuid-123',
    description: 'Video call ID where the image was shared',
  })
  @IsString({ message: 'Call ID must be a string' })
  @IsNotEmpty({ message: 'Call ID is required' })
  callId!: string;

  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID who shared the image',
  })
  @IsString({ message: 'User ID must be a string' })
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;
}

/**
 * Data Transfer Object for video call history query
 * @class VideoCallHistoryQueryDto
 */
export class VideoCallHistoryQueryDto {
  @ApiPropertyOptional({
    example: 'user-uuid-123',
    description: 'User ID to get history for (optional, defaults to authenticated user)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Clinic ID to filter by (optional)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Page number (1-based)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Page must be a number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    description: 'Items per page',
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Limit must be a number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit cannot exceed 100' })
  limit?: number = 20;
}

/**
 * Data Transfer Object for reporting technical issues
 * @class ReportTechnicalIssueDto
 */
export class ReportTechnicalIssueDto {
  @ApiProperty({
    example: 'audio',
    description: 'Type of technical issue',
    enum: ['audio', 'video', 'connection', 'other'],
  })
  @IsEnum(['audio', 'video', 'connection', 'other'], {
    message: 'Issue type must be one of: audio, video, connection, other',
  })
  @IsNotEmpty({ message: 'Issue type is required' })
  issueType!: 'audio' | 'video' | 'connection' | 'other';

  @ApiProperty({
    example: 'Audio cutting out intermittently during consultation',
    description: 'Detailed description of the technical issue',
  })
  @IsString({ message: 'Description must be a string' })
  @IsNotEmpty({ message: 'Description is required' })
  description!: string;
}

/**
 * Data Transfer Object for video call response
 * @class VideoCallResponseDto
 */
export class VideoCallResponseDto {
  @ApiProperty({
    example: 'vc-appointment-123-1234567890',
    description: 'Video call ID',
  })
  @IsString({ message: 'Call ID must be a string' })
  id!: string;

  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID',
  })
  @IsString({ message: 'Appointment ID must be a string' })
  appointmentId!: string;

  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID',
  })
  @IsString({ message: 'Patient ID must be a string' })
  patientId!: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID',
  })
  @IsString({ message: 'Doctor ID must be a string' })
  doctorId!: string;

  @ApiProperty({
    example: 'clinic-uuid-123',
    description: 'Clinic ID',
  })
  @IsString({ message: 'Clinic ID must be a string' })
  clinicId!: string;

  @ApiProperty({
    example: 'scheduled',
    description: 'Video call status',
    enum: VideoCallStatus,
  })
  @IsEnum(VideoCallStatus, {
    message: 'Status must be a valid video call status',
  })
  status!: VideoCallStatus;

  @ApiProperty({
    example: 'https://video.example.com/room/appointment-123',
    description: 'Meeting URL',
  })
  @IsUrl({}, { message: 'Meeting URL must be a valid URL' })
  meetingUrl!: string;

  @ApiProperty({
    description: 'Call participants',
    type: [String],
  })
  @IsArray({ message: 'Participants must be an array' })
  @IsString({ each: true, message: 'Each participant must be a string' })
  participants!: string[];

  @ApiProperty({
    description: 'Video call settings',
    type: Object,
  })
  @IsObject({ message: 'Settings must be an object' })
  settings!: {
    maxParticipants: number;
    recordingEnabled: boolean;
    screenSharingEnabled: boolean;
    chatEnabled: boolean;
    waitingRoomEnabled: boolean;
    autoRecord: boolean;
  };

  @ApiPropertyOptional({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Call start time',
  })
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Call end time',
  })
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({
    example: 1800,
    description: 'Call duration in seconds',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Duration must be a number' })
  duration?: number;
}

/**
 * Data Transfer Object for video call history response
 * @class VideoCallHistoryResponseDto
 */
export class VideoCallHistoryResponseDto {
  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID for the history',
  })
  @IsString({ message: 'User ID must be a string' })
  userId!: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Clinic ID (if filtered)',
  })
  @IsOptional()
  @IsString({ message: 'Clinic ID must be a string' })
  clinicId?: string;

  @ApiProperty({
    description: 'List of video calls',
    type: [VideoCallResponseDto],
  })
  @IsArray({ message: 'Calls must be an array' })
  calls!: VideoCallResponseDto[];

  @ApiProperty({
    example: 25,
    description: 'Total number of calls',
  })
  @IsNumber({}, { message: 'Total must be a number' })
  total!: number;

  @ApiProperty({
    example: '2024-01-15T12:00:00.000Z',
    description: 'Timestamp when history was retrieved',
  })
  @IsString({ message: 'Retrieved at must be a string' })
  retrievedAt!: string;
}

/**
 * Data Transfer Object for video token response
 * @class VideoTokenResponseDto
 */
export class VideoTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT token for joining video consultation',
  })
  @IsString({ message: 'Token must be a string' })
  token!: string;

  @ApiProperty({
    example: 'appointment-123-abc',
    description: 'Room name for the video consultation',
  })
  @IsString({ message: 'Room name must be a string' })
  roomName!: string;

  @ApiProperty({
    example: 'room-uuid-123',
    description: 'Room ID for the video consultation',
  })
  @IsString({ message: 'Room ID must be a string' })
  roomId!: string;

  @ApiProperty({
    example: 'https://video.example.com/room/appointment-123',
    description: 'Meeting URL for joining the consultation',
  })
  @IsUrl({}, { message: 'Meeting URL must be a valid URL' })
  meetingUrl!: string;

  @ApiPropertyOptional({
    example: 'password123',
    description: 'Room password (if required)',
  })
  @IsOptional()
  @IsString({ message: 'Room password must be a string' })
  roomPassword?: string;

  @ApiPropertyOptional({
    example: 'meeting123',
    description: 'Meeting password (if required)',
  })
  @IsOptional()
  @IsString({ message: 'Meeting password must be a string' })
  meetingPassword?: string;

  @ApiPropertyOptional({
    example: 'encryption-key-123',
    description: 'Encryption key for secure communication',
  })
  @IsOptional()
  @IsString({ message: 'Encryption key must be a string' })
  encryptionKey?: string;

  @ApiPropertyOptional({
    example: '2024-01-15T12:00:00.000Z',
    description: 'Token expiration date',
  })
  @IsOptional()
  expiresAt?: Date;
}

/**
 * Data Transfer Object for video consultation session response
 * @class VideoConsultationSessionDto
 */
export class VideoConsultationSessionDto {
  @ApiProperty({
    example: 'session-uuid-123',
    description: 'Session ID',
  })
  @IsString({ message: 'Session ID must be a string' })
  id!: string;

  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID',
  })
  @IsString({ message: 'Appointment ID must be a string' })
  appointmentId!: string;

  @ApiProperty({
    example: 'room-uuid-123',
    description: 'Room ID',
  })
  @IsString({ message: 'Room ID must be a string' })
  roomId!: string;

  @ApiProperty({
    example: 'appointment-123-abc',
    description: 'Room name',
  })
  @IsString({ message: 'Room name must be a string' })
  roomName!: string;

  @ApiProperty({
    example: 'https://video.example.com/room/appointment-123',
    description: 'Meeting URL',
  })
  @IsUrl({}, { message: 'Meeting URL must be a valid URL' })
  meetingUrl!: string;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'Session status',
    enum: ['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'],
  })
  @IsEnum(['SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'], {
    message: 'Status must be a valid session status',
  })
  status!: 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

  @ApiPropertyOptional({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Session start time',
  })
  @IsOptional()
  startTime?: Date | null;

  @ApiPropertyOptional({
    example: '2024-01-15T10:30:00.000Z',
    description: 'Session end time',
  })
  @IsOptional()
  endTime?: Date | null;

  @ApiProperty({
    description: 'Session participants',
    type: [Object],
  })
  @IsArray({ message: 'Participants must be an array' })
  participants!: Array<{
    userId: string;
    role: 'HOST' | 'PARTICIPANT';
    joinedAt: Date | null;
  }>;

  @ApiProperty({
    example: true,
    description: 'Whether recording is enabled',
  })
  @IsBoolean({ message: 'Recording enabled must be a boolean' })
  recordingEnabled!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether screen sharing is enabled',
  })
  @IsBoolean({ message: 'Screen sharing enabled must be a boolean' })
  screenSharingEnabled!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether chat is enabled',
  })
  @IsBoolean({ message: 'Chat enabled must be a boolean' })
  chatEnabled!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether waiting room is enabled',
  })
  @IsBoolean({ message: 'Waiting room enabled must be a boolean' })
  waitingRoomEnabled!: boolean;
}

/**
 * Data Transfer Object for starting OpenVidu recording
 * @class StartRecordingDto
 */
export class StartRecordingDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiPropertyOptional({
    example: 'COMPOSED',
    description: 'Recording output mode',
    enum: ['COMPOSED', 'INDIVIDUAL'],
  })
  @IsOptional()
  @IsEnum(['COMPOSED', 'INDIVIDUAL'], {
    message: 'Output mode must be either "COMPOSED" or "INDIVIDUAL"',
  })
  outputMode?: 'COMPOSED' | 'INDIVIDUAL';

  @ApiPropertyOptional({
    example: '1280x720',
    description: 'Recording resolution',
  })
  @IsOptional()
  @IsString({ message: 'Resolution must be a string' })
  resolution?: string;

  @ApiPropertyOptional({
    example: 30,
    description: 'Recording frame rate',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Frame rate must be a number' })
  @Min(1, { message: 'Frame rate must be at least 1' })
  @Max(60, { message: 'Frame rate must be at most 60' })
  frameRate?: number;

  @ApiPropertyOptional({
    example: 'custom-layout-id',
    description: 'Custom layout ID for recording',
  })
  @IsOptional()
  @IsString({ message: 'Custom layout ID must be a string' })
  customLayout?: string;
}

/**
 * Data Transfer Object for stopping OpenVidu recording
 * @class StopRecordingDto
 */
export class StopRecordingDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiProperty({
    example: 'recording-id-123',
    description: 'Recording ID to stop',
  })
  @IsString({ message: 'Recording ID must be a string' })
  @IsNotEmpty({ message: 'Recording ID is required' })
  recordingId!: string;
}

/**
 * Data Transfer Object for participant management
 * @class ManageParticipantDto
 */
export class ManageParticipantDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;

  @ApiProperty({
    example: 'connection-id-123',
    description: 'OpenVidu connection ID of the participant',
  })
  @IsString({ message: 'Connection ID must be a string' })
  @IsNotEmpty({ message: 'Connection ID is required' })
  connectionId!: string;

  @ApiProperty({
    example: 'kick',
    description: 'Action to perform on participant',
    enum: ['kick', 'mute', 'unmute', 'forceUnpublish'],
  })
  @IsEnum(['kick', 'mute', 'unmute', 'forceUnpublish'], {
    message: 'Action must be one of: kick, mute, unmute, forceUnpublish',
  })
  @IsNotEmpty({ message: 'Action is required' })
  action!: 'kick' | 'mute' | 'unmute' | 'forceUnpublish';
}

/**
 * Data Transfer Object for getting session analytics
 * @class GetSessionAnalyticsDto
 */
export class GetSessionAnalyticsDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Appointment ID for the video consultation',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment ID is required' })
  appointmentId!: string;
}

/**
 * Response DTO for OpenVidu recording
 * @class RecordingResponseDto
 */
export class RecordingResponseDto {
  @ApiProperty({
    example: 'recording-id-123',
    description: 'Recording ID',
  })
  recordingId!: string;

  @ApiProperty({
    example: 'https://video.example.com/recordings/recording-id-123.mp4',
    description: 'Recording URL',
  })
  url!: string;

  @ApiProperty({
    example: 3600,
    description: 'Recording duration in seconds',
  })
  duration!: number;

  @ApiProperty({
    example: 104857600,
    description: 'Recording size in bytes',
  })
  size!: number;

  @ApiProperty({
    example: 'ready',
    description: 'Recording status',
    enum: ['starting', 'started', 'stopped', 'ready', 'failed'],
  })
  status!: 'starting' | 'started' | 'stopped' | 'ready' | 'failed';

  @ApiProperty({
    example: '2025-12-11T10:00:00Z',
    description: 'Recording creation timestamp',
  })
  createdAt!: string;
}

/**
 * Response DTO for OpenVidu session analytics
 * @class SessionAnalyticsResponseDto
 */
export class SessionAnalyticsResponseDto {
  @ApiProperty({
    example: 'session-id-123',
    description: 'Session ID',
  })
  sessionId!: string;

  @ApiProperty({
    example: 3600,
    description: 'Session duration in seconds',
  })
  duration!: number;

  @ApiProperty({
    example: 2,
    description: 'Number of participants',
  })
  numberOfParticipants!: number;

  @ApiProperty({
    example: 2,
    description: 'Number of connections',
  })
  numberOfConnections!: number;

  @ApiProperty({
    example: 1,
    description: 'Number of recordings',
  })
  recordingCount!: number;

  @ApiProperty({
    example: 3600,
    description: 'Total recording duration in seconds',
  })
  recordingTotalDuration!: number;

  @ApiProperty({
    example: 104857600,
    description: 'Total recording size in bytes',
  })
  recordingTotalSize!: number;

  @ApiProperty({
    description: 'Connection details',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        connectionId: { type: 'string' },
        duration: { type: 'number' },
        location: { type: 'string' },
        platform: { type: 'string' },
        publishers: { type: 'number' },
        subscribers: { type: 'number' },
      },
    },
  })
  connections!: Array<{
    connectionId: string;
    duration: number;
    location?: string;
    platform?: string;
    publishers: number;
    subscribers: number;
  }>;
}

/**
 * Response DTO for OpenVidu participant list
 * @class ParticipantListResponseDto
 */
export class ParticipantListResponseDto {
  @ApiProperty({
    example: 2,
    description: 'Number of participants',
  })
  count!: number;

  @ApiProperty({
    description: 'List of participants',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        connectionId: { type: 'string' },
        role: { type: 'string', enum: ['PUBLISHER', 'SUBSCRIBER', 'MODERATOR'] },
        location: { type: 'string' },
        platform: { type: 'string' },
        streams: { type: 'array' },
      },
    },
  })
  participants!: Array<{
    id: string;
    connectionId: string;
    role: 'PUBLISHER' | 'SUBSCRIBER' | 'MODERATOR';
    location?: string;
    platform?: string;
    streams: Array<{
      streamId: string;
      hasAudio: boolean;
      hasVideo: boolean;
      audioActive: boolean;
      videoActive: boolean;
      typeOfVideo: 'CAMERA' | 'SCREEN';
    }>;
  }>;
}

/**
 * Response DTO for OpenVidu recording list
 * @class RecordingListResponseDto
 */
export class RecordingListResponseDto {
  @ApiProperty({
    example: 5,
    description: 'Number of recordings',
  })
  count!: number;

  @ApiProperty({
    description: 'List of recordings',
    type: 'array',
    items: {
      type: 'object',
    },
  })
  recordings!: Array<RecordingResponseDto>;
}
