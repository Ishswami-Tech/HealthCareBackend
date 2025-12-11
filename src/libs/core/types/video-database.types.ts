/**
 * Video Database Types
 * Strict type definitions for Prisma video consultation operations
 * Replaces unsafe `as unknown as` assertions with proper types
 */

import type { PrismaTransactionClient } from './database.types';

/**
 * VideoConsultation database model structure
 */
export interface VideoConsultationDbModel {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  roomId: string;
  status: string;
  meetingUrl: string | null;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  recordingUrl: string | null;
  recordingEnabled: boolean;
  screenSharingEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomEnabled: boolean;
  autoRecord: boolean;
  maxParticipants: number;
  isRecording?: boolean;
  recordingId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * VideoConsultation with participants
 */
export interface VideoConsultationWithParticipants extends VideoConsultationDbModel {
  participants: Array<{ userId: string }>;
}

/**
 * VideoRecording database model structure
 */
export interface VideoRecordingDbModel {
  id: string;
  consultationId: string;
  fileName: string;
  filePath: string;
  format: string;
  quality: string;
  storageProvider: string;
  isProcessed: boolean;
  duration?: number | null;
  storageUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Type-safe accessor for videoConsultation delegate
 * Prisma guarantees this delegate exists at runtime
 */
export function getVideoConsultationDelegate(client: PrismaTransactionClient): {
  findUnique: (args: {
    where: { appointmentId: string };
  }) => Promise<VideoConsultationDbModel | null>;
  findFirst: (args: {
    where: { OR: Array<{ roomId: string } | { appointmentId: string }> };
    include?: { participants: boolean };
  }) => Promise<VideoConsultationWithParticipants | null>;
  findMany: (args: {
    where?: {
      clinicId?: string;
      OR?: Array<
        | { patientId: string }
        | { doctorId: string }
        | { participants: { some: { userId: string } } }
      >;
    };
    include?: { participants: boolean };
    orderBy?: { createdAt: 'desc' | 'asc' };
    take?: number;
  }) => Promise<VideoConsultationWithParticipants[]>;
  create: (args: { data: unknown }) => Promise<VideoConsultationDbModel>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<VideoConsultationDbModel>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoConsultation' in client) ||
    typeof (client as { videoConsultation: unknown }).videoConsultation !== 'object'
  ) {
    throw new Error('Prisma client does not have videoConsultation delegate');
  }
  return (
    client as unknown as {
      videoConsultation: {
        findUnique: (args: {
          where: { appointmentId: string };
        }) => Promise<VideoConsultationDbModel | null>;
        findFirst: (args: {
          where: { OR: Array<{ roomId: string } | { appointmentId: string }> };
          include?: { participants: boolean };
        }) => Promise<VideoConsultationWithParticipants | null>;
        findMany: (args: {
          where?: {
            clinicId?: string;
            OR?: Array<
              | { patientId: string }
              | { doctorId: string }
              | { participants: { some: { userId: string } } }
            >;
          };
          include?: { participants: boolean };
          orderBy?: { createdAt: 'desc' | 'asc' };
          take?: number;
        }) => Promise<VideoConsultationWithParticipants[]>;
        create: (args: { data: unknown }) => Promise<VideoConsultationDbModel>;
        update: (args: {
          where: { id: string };
          data: unknown;
        }) => Promise<VideoConsultationDbModel>;
      };
    }
  ).videoConsultation;
}

/**
 * Type-safe accessor for videoRecording delegate
 * Prisma guarantees this delegate exists at runtime
 */
export function getVideoRecordingDelegate(client: PrismaTransactionClient): {
  findFirst: (args: {
    where: { consultationId: string; isProcessed: boolean };
    orderBy?: { createdAt: 'desc' | 'asc' };
  }) => Promise<VideoRecordingDbModel | null>;
  create: (args: { data: unknown }) => Promise<VideoRecordingDbModel>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<VideoRecordingDbModel>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoRecording' in client) ||
    typeof (client as { videoRecording: unknown }).videoRecording !== 'object'
  ) {
    throw new Error('Prisma client does not have videoRecording delegate');
  }
  return (
    client as unknown as {
      videoRecording: {
        findFirst: (args: {
          where: { consultationId: string; isProcessed: boolean };
          orderBy?: { createdAt: 'desc' | 'asc' };
        }) => Promise<VideoRecordingDbModel | null>;
        create: (args: { data: unknown }) => Promise<VideoRecordingDbModel>;
        update: (args: { where: { id: string }; data: unknown }) => Promise<VideoRecordingDbModel>;
      };
    }
  ).videoRecording;
}
