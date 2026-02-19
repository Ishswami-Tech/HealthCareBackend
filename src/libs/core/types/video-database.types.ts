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
    where: { appointmentId: string } | { id: string };
  }) => Promise<VideoConsultationDbModel | null>;
  findFirst: (args: {
    where: {
      OR?: Array<{ roomId: string } | { appointmentId: string } | { id: string }>;
      id?: string;
      appointmentId?: string;
    };
    include?: { participants?: boolean; appointment?: boolean };
  }) => Promise<VideoConsultationWithParticipants | null>;
  findMany: (args: {
    where?: {
      clinicId?: string;
      status?: string | { not?: string };
      startTime?: { lt?: Date; gt?: Date };
      appointment?: {
        status?: { in?: string[] } | string;
      };
      OR?: Array<
        | { patientId: string }
        | { doctorId: string }
        | { participants: { some: { userId: string } } }
      >;
    };
    include?: { participants?: boolean; appointment?: boolean };
    orderBy?: { createdAt: 'desc' | 'asc' };
    take?: number;
  }) => Promise<VideoConsultationWithParticipants[]>;
  updateMany: (args: {
    where: { appointmentId?: string; status?: { not?: string } };
    data: { status: string };
  }) => Promise<{ count: number }>;
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
          where: { appointmentId: string } | { id: string };
        }) => Promise<VideoConsultationDbModel | null>;
        findFirst: (args: {
          where: {
            OR?: Array<{ roomId: string } | { appointmentId: string } | { id: string }>;
            id?: string;
            appointmentId?: string;
          };
          include?: { participants?: boolean; appointment?: boolean };
        }) => Promise<VideoConsultationWithParticipants | null>;
        findMany: (args: {
          where?: {
            clinicId?: string;
            status?: string | { not?: string };
            startTime?: { lt?: Date; gt?: Date };
            appointment?: {
              status?: { in?: string[] } | string;
            };
            OR?: Array<
              | { patientId: string }
              | { doctorId: string }
              | { participants: { some: { userId: string } } }
            >;
          };
          include?: { participants?: boolean; appointment?: boolean };
          orderBy?: { createdAt: 'desc' | 'asc' };
          take?: number;
        }) => Promise<VideoConsultationWithParticipants[]>;
        updateMany: (args: {
          where: { appointmentId?: string; status?: { not?: string } };
          data: { status: string };
        }) => Promise<{ count: number }>;
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

/**
 * Type-safe accessor for videoChatMessage delegate
 */
export function getVideoChatMessageDelegate(client: PrismaTransactionClient): {
  create: (args: { data: unknown; include?: unknown }) => Promise<unknown>;
  findMany: (args: {
    where: unknown;
    include?: unknown;
    orderBy?: unknown;
    take?: number;
  }) => Promise<unknown[]>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  findFirst: (args: { where: unknown }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoChatMessage' in client) ||
    typeof (client as { videoChatMessage: unknown }).videoChatMessage !== 'object'
  ) {
    throw new Error('Prisma client does not have videoChatMessage delegate');
  }
  return (client as unknown as { videoChatMessage: unknown }).videoChatMessage as {
    create: (args: { data: unknown; include?: unknown }) => Promise<unknown>;
    findMany: (args: {
      where: unknown;
      include?: unknown;
      orderBy?: unknown;
      take?: number;
    }) => Promise<unknown[]>;
    findUnique: (args: { where: { id: string } }) => Promise<unknown>;
    findFirst: (args: { where: unknown }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
  };
}

/**
 * Type-safe accessor for videoConsultationNote delegate
 */
export function getVideoConsultationNoteDelegate(client: PrismaTransactionClient): {
  create: (args: { data: unknown }) => Promise<unknown>;
  findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoConsultationNote' in client) ||
    typeof (client as { videoConsultationNote: unknown }).videoConsultationNote !== 'object'
  ) {
    throw new Error('Prisma client does not have videoConsultationNote delegate');
  }
  return (client as unknown as { videoConsultationNote: unknown }).videoConsultationNote as {
    create: (args: { data: unknown }) => Promise<unknown>;
    findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
    findUnique: (args: { where: { id: string } }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
    updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
  };
}

/**
 * Type-safe accessor for videoAnnotation delegate
 */
export function getVideoAnnotationDelegate(client: PrismaTransactionClient): {
  create: (args: { data: unknown }) => Promise<unknown>;
  findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoAnnotation' in client) ||
    typeof (client as { videoAnnotation: unknown }).videoAnnotation !== 'object'
  ) {
    throw new Error('Prisma client does not have videoAnnotation delegate');
  }
  return (client as unknown as { videoAnnotation: unknown }).videoAnnotation as {
    create: (args: { data: unknown }) => Promise<unknown>;
    findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
    findUnique: (args: { where: { id: string } }) => Promise<unknown>;
    update: (args: { where: { id: string }; data: unknown }) => Promise<unknown>;
    updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
  };
}

/**
 * Type-safe accessor for videoTranscription delegate
 */
export function getVideoTranscriptionDelegate(client: PrismaTransactionClient): {
  create: (args: { data: unknown }) => Promise<unknown>;
  findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
  updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoTranscription' in client) ||
    typeof (client as { videoTranscription: unknown }).videoTranscription !== 'object'
  ) {
    throw new Error('Prisma client does not have videoTranscription delegate');
  }
  return (client as unknown as { videoTranscription: unknown }).videoTranscription as {
    create: (args: { data: unknown }) => Promise<unknown>;
    findMany: (args: { where: unknown; orderBy?: unknown }) => Promise<unknown[]>;
    updateMany: (args: { where: unknown; data: unknown }) => Promise<unknown>;
  };
}

/**
 * VideoParticipant database model structure
 */
export interface VideoParticipantDbModel {
  id: string;
  consultationId: string;
  userId: string;
  role: string;
  status: string;
  joinedAt: Date | null;
  leftAt: Date | null;
  duration: number | null;
  peerId: string | null;
  connectionId: string | null;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  audioQuality: number | null;
  videoQuality: number | null;
  connectionQuality: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Type-safe accessor for videoParticipant delegate
 */
export function getVideoParticipantDelegate(client: PrismaTransactionClient): {
  findFirst: (args: {
    where: {
      consultationId?: string;
      userId?: string;
    };
  }) => Promise<VideoParticipantDbModel | null>;
  update: (args: { where: { id: string }; data: unknown }) => Promise<VideoParticipantDbModel>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('videoParticipant' in client) ||
    typeof (client as { videoParticipant: unknown }).videoParticipant !== 'object'
  ) {
    throw new Error('Prisma client does not have videoParticipant delegate');
  }
  return (client as unknown as { videoParticipant: unknown }).videoParticipant as {
    findFirst: (args: {
      where: {
        consultationId?: string;
        userId?: string;
      };
    }) => Promise<VideoParticipantDbModel | null>;
    update: (args: { where: { id: string }; data: unknown }) => Promise<VideoParticipantDbModel>;
  };
}

/**
 * Type-safe accessor for waitingRoomEntry delegate
 */
export function getWaitingRoomEntryDelegate(client: PrismaTransactionClient): {
  create: (args: { data: unknown; include?: unknown }) => Promise<unknown>;
  findMany: (args: { where: unknown; include?: unknown; orderBy?: unknown }) => Promise<unknown[]>;
  findFirst: (args: { where: unknown; include?: unknown }) => Promise<unknown>;
  count: (args: { where: unknown }) => Promise<number>;
  update: (args: { where: { id: string }; data: unknown; include?: unknown }) => Promise<unknown>;
} {
  if (
    typeof client !== 'object' ||
    client === null ||
    !('waitingRoomEntry' in client) ||
    typeof (client as { waitingRoomEntry: unknown }).waitingRoomEntry !== 'object'
  ) {
    throw new Error('Prisma client does not have waitingRoomEntry delegate');
  }
  return (client as unknown as { waitingRoomEntry: unknown }).waitingRoomEntry as {
    create: (args: { data: unknown; include?: unknown }) => Promise<unknown>;
    findMany: (args: {
      where: unknown;
      include?: unknown;
      orderBy?: unknown;
    }) => Promise<unknown[]>;
    findFirst: (args: { where: unknown; include?: unknown }) => Promise<unknown>;
    count: (args: { where: unknown }) => Promise<number>;
    update: (args: { where: { id: string }; data: unknown; include?: unknown }) => Promise<unknown>;
  };
}
