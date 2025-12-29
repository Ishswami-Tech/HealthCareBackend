/**
 * Video Waiting Room Service
 * @class VideoWaitingRoomService
 * @description Manages waiting room queue for video consultations
 * Supports queue management, doctor admission, estimated wait time, and notifications
 */

import { Injectable, Inject, forwardRef, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { SocketService } from '@communication/channels/socket/socket.service';
import { EventService } from '@infrastructure/events';
import { QueueService } from '@queue/src/queue.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import type { PrismaTransactionClient } from '@core/types/database.types';

export interface WaitingRoomEntry {
  id: string;
  consultationId: string;
  userId: string;
  status: 'WAITING' | 'ADMITTED' | 'LEFT' | 'CANCELLED';
  position: number;
  estimatedWaitTime?: number;
  admittedAt?: Date;
  notifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}

import type { JoinWaitingRoomDto, AdmitPatientDto } from '@dtos/video.dto';

@Injectable()
export class VideoWaitingRoomService {
  private readonly WAITING_ROOM_CACHE_TTL = 1800; // 30 minutes
  private readonly AVERAGE_CONSULTATION_TIME = 900; // 15 minutes in seconds
  private readonly NOTIFICATION_QUEUE = 'notification-queue';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => SocketService))
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  /**
   * Join waiting room
   */
  async joinWaitingRoom(dto: JoinWaitingRoomDto): Promise<WaitingRoomEntry> {
    try {
      // Validate consultation exists and has waiting room enabled
      const consultation = await this.validateWaitingRoomEnabled(dto.consultationId);

      // Check if user is already in waiting room
      const existing = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.findFirst({
            where: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              status: 'WAITING',
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
            user?: {
              id: string;
              name: string;
              email: string;
              profilePicture?: string | null;
            } | null;
          } | null;
          return result;
        }
      );

      if (existing) {
        return this.mapToWaitingRoomEntry(existing);
      }

      // Get current queue position
      const queueCount = await this.databaseService.executeHealthcareRead(async client => {
        const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
        const delegate = getWaitingRoomEntryDelegate(client);
        return await delegate.count({
          where: {
            consultationId: dto.consultationId,
            status: 'WAITING',
          },
        });
      });

      const position = queueCount + 1;
      const estimatedWaitTime = await this.calculateEstimatedWaitTime(dto.consultationId, position);

      // Create waiting room entry
      const entryResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.create({
            data: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              status: 'WAITING',
              position,
              estimatedWaitTime,
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
            user?: {
              id: string;
              name: string;
              email: string;
              profilePicture?: string | null;
            } | null;
          };
          return result;
        },
        {
          userId: dto.userId,
          userRole: 'PATIENT',
          clinicId: consultation.clinicId,
          operation: 'CREATE_WAITING_ROOM_ENTRY',
          resourceType: 'WAITING_ROOM_ENTRY',
          resourceId: dto.consultationId,
          timestamp: new Date(),
        }
      );

      // Map to WaitingRoomEntry interface
      const mappedEntry = this.mapToWaitingRoomEntry(entryResult);

      // Emit real-time update via Socket.IO
      const socketData: Record<
        string,
        string | number | boolean | null | Record<string, string | number | boolean | null>
      > = {
        id: mappedEntry.id,
        consultationId: mappedEntry.consultationId,
        userId: mappedEntry.userId,
        status: mappedEntry.status,
        position: mappedEntry.position,
        createdAt: mappedEntry.createdAt.toISOString(),
        updatedAt: mappedEntry.updatedAt.toISOString(),
      };

      if (mappedEntry.estimatedWaitTime !== undefined) {
        socketData['estimatedWaitTime'] = mappedEntry.estimatedWaitTime;
      }
      if (mappedEntry.admittedAt) {
        socketData['admittedAt'] = mappedEntry.admittedAt.toISOString();
      }
      if (mappedEntry.notifiedAt) {
        socketData['notifiedAt'] = mappedEntry.notifiedAt.toISOString();
      }
      if (mappedEntry.user) {
        socketData['user'] = {
          id: mappedEntry.user.id,
          name: mappedEntry.user.name,
          email: mappedEntry.user.email,
          ...(mappedEntry.user.avatar && { avatar: mappedEntry.user.avatar }),
        };
      }

      this.socketService.sendToRoom(`consultation_${dto.consultationId}`, 'waiting_room_joined', {
        ...socketData,
        queuePosition: position,
        estimatedWaitTime,
      });

      // Notify doctor
      await this.notifyDoctor(dto.consultationId, consultation.doctorId, position);

      // Emit event
      await this.eventService.emitEnterprise('video.waiting_room.joined', {
        eventId: `waiting-room-joined-${entryResult.id}-${Date.now()}`,
        eventType: 'video.waiting_room.joined',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'VideoWaitingRoomService',
        version: '1.0.0',
        payload: {
          entryId: entryResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          position,
          estimatedWaitTime,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `User joined waiting room: ${entryResult.id}`,
        'VideoWaitingRoomService',
        {
          entryId: entryResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          position,
        }
      );

      return mappedEntry;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to join waiting room: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoWaitingRoomService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId: dto.consultationId,
          userId: dto.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Admit patient from waiting room
   */
  async admitPatient(dto: AdmitPatientDto): Promise<WaitingRoomEntry> {
    try {
      // Validate doctor is the consultation doctor
      const consultation = await this.validateDoctorAccess(dto.consultationId, dto.doctorId);

      // Get waiting room entry
      const entryResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.findFirst({
            where: {
              consultationId: dto.consultationId,
              userId: dto.userId,
              status: 'WAITING',
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
            user?: {
              id: string;
              name: string;
              email: string;
              profilePicture?: string | null;
            } | null;
          } | null;
          return result;
        }
      );

      if (!entryResult) {
        throw new NotFoundException(
          `Waiting room entry not found for user ${dto.userId} in consultation ${dto.consultationId}`
        );
      }

      // Update entry status
      const updatedResult = await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.update({
            where: { id: entryResult.id },
            data: {
              status: 'ADMITTED',
              admittedAt: new Date(),
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
            user?: {
              id: string;
              name: string;
              email: string;
              profilePicture?: string | null;
            } | null;
          };
          return result;
        },
        {
          userId: dto.doctorId,
          userRole: 'DOCTOR',
          clinicId: consultation.clinicId,
          operation: 'ADMIT_WAITING_ROOM_PATIENT',
          resourceType: 'WAITING_ROOM_ENTRY',
          resourceId: entryResult.id,
          timestamp: new Date(),
        }
      );

      // Map to WaitingRoomEntry interface
      const mappedUpdated = this.mapToWaitingRoomEntry(updatedResult);

      // Update queue positions for remaining waiting users
      await this.updateQueuePositions(dto.consultationId);

      // Emit real-time update via Socket.IO
      const socketData: Record<
        string,
        string | number | boolean | null | Record<string, string | number | boolean | null>
      > = {
        id: mappedUpdated.id,
        consultationId: mappedUpdated.consultationId,
        userId: mappedUpdated.userId,
        status: mappedUpdated.status,
        position: mappedUpdated.position,
        createdAt: mappedUpdated.createdAt.toISOString(),
        updatedAt: mappedUpdated.updatedAt.toISOString(),
      };

      if (mappedUpdated.estimatedWaitTime !== undefined) {
        socketData['estimatedWaitTime'] = mappedUpdated.estimatedWaitTime;
      }
      if (mappedUpdated.admittedAt) {
        socketData['admittedAt'] = mappedUpdated.admittedAt.toISOString();
      }
      if (mappedUpdated.notifiedAt) {
        socketData['notifiedAt'] = mappedUpdated.notifiedAt.toISOString();
      }
      if (mappedUpdated.user) {
        socketData['user'] = {
          id: mappedUpdated.user.id,
          name: mappedUpdated.user.name,
          email: mappedUpdated.user.email,
          ...(mappedUpdated.user.avatar && { avatar: mappedUpdated.user.avatar }),
        };
      }

      this.socketService.sendToRoom(
        `consultation_${dto.consultationId}`,
        'patient_admitted',
        socketData
      );

      // Notify patient
      await this.notifyPatient(dto.userId, dto.consultationId);

      // Emit event
      await this.eventService.emitEnterprise('video.waiting_room.admitted', {
        eventId: `waiting-room-admitted-${updatedResult.id}-${Date.now()}`,
        eventType: 'video.waiting_room.admitted',
        category: EventCategory.SYSTEM,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'VideoWaitingRoomService',
        version: '1.0.0',
        payload: {
          entryId: updatedResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
          doctorId: dto.doctorId,
        },
      });

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Patient admitted from waiting room: ${updatedResult.id}`,
        'VideoWaitingRoomService',
        {
          entryId: updatedResult.id,
          consultationId: dto.consultationId,
          userId: dto.userId,
        }
      );

      return mappedUpdated;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to admit patient: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoWaitingRoomService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId: dto.consultationId,
          userId: dto.userId,
        }
      );
      throw error;
    }
  }

  /**
   * Get waiting room queue
   */
  async getWaitingRoomQueue(consultationId: string): Promise<WaitingRoomEntry[]> {
    try {
      const cacheKey = `waiting_room:queue:${consultationId}`;
      const cached = await this.cacheService.get<WaitingRoomEntry[]>(cacheKey);
      if (cached) {
        return cached;
      }

      const entriesResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.findMany({
            where: {
              consultationId,
              status: 'WAITING',
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  profilePicture: true,
                },
              },
            },
            orderBy: {
              position: 'asc',
            },
          })) as Array<{
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
            user?: {
              id: string;
              name: string;
              email: string;
              profilePicture?: string | null;
            } | null;
          }>;
          return result;
        }
      );

      const result = entriesResult.map(entry => this.mapToWaitingRoomEntry(entry));

      // Cache result
      await this.cacheService.set(cacheKey, result, this.WAITING_ROOM_CACHE_TTL);

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get waiting room queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoWaitingRoomService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
        }
      );
      throw error;
    }
  }

  /**
   * Leave waiting room
   */
  async leaveWaitingRoom(consultationId: string, userId: string): Promise<void> {
    try {
      const entryResult = await this.databaseService.executeHealthcareRead(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          const result = (await delegate.findFirst({
            where: {
              consultationId,
              userId,
              status: 'WAITING',
            },
          })) as {
            id: string;
            consultationId: string;
            userId: string;
            status: string;
            position: number;
            estimatedWaitTime?: number | null;
            admittedAt?: Date | null;
            notifiedAt?: Date | null;
            createdAt: Date;
            updatedAt: Date;
          } | null;
          return result;
        }
      );

      if (!entryResult) {
        return; // Already left or not in waiting room
      }

      await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          await delegate.update({
            where: { id: entryResult.id },
            data: {
              status: 'LEFT',
            },
          });
        },
        {
          userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'LEAVE_WAITING_ROOM',
          resourceType: 'WAITING_ROOM_ENTRY',
          resourceId: entryResult.id,
          timestamp: new Date(),
        }
      );

      // Update queue positions
      await this.updateQueuePositions(consultationId);

      // Emit real-time update
      this.socketService.sendToRoom(`consultation_${consultationId}`, 'waiting_room_left', {
        consultationId,
        userId,
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to leave waiting room: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VideoWaitingRoomService',
        {
          error: error instanceof Error ? error.message : String(error),
          consultationId,
          userId,
        }
      );
      throw error;
    }
  }

  /**
   * Calculate estimated wait time based on queue position
   * Uses historical data from cache when available
   */
  private async calculateEstimatedWaitTime(
    consultationId: string,
    position: number
  ): Promise<number> {
    try {
      // Try to get historical average consultation time from cache
      const historicalCacheKey = `waiting_room:avg_time:${consultationId}`;
      const historicalAvg = await this.cacheService.get<number>(historicalCacheKey);

      if (historicalAvg && historicalAvg > 0) {
        // Use historical data if available
        return position * historicalAvg;
      }

      // Fallback to default average consultation time
      return position * this.AVERAGE_CONSULTATION_TIME;
    } catch (error) {
      // On error, use default calculation
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Failed to get historical wait time data: ${error instanceof Error ? error.message : String(error)}`,
        'VideoWaitingRoomService.calculateEstimatedWaitTime',
        { consultationId, position }
      );
      return position * this.AVERAGE_CONSULTATION_TIME;
    }
  }

  /**
   * Update queue positions after admission or leave
   */
  private async updateQueuePositions(consultationId: string): Promise<void> {
    const entriesResult = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
        const delegate = getWaitingRoomEntryDelegate(client);
        const result = (await delegate.findMany({
          where: {
            consultationId,
            status: 'WAITING',
          },
          orderBy: {
            createdAt: 'asc',
          },
        })) as Array<{
          id: string;
          consultationId: string;
          userId: string;
          status: string;
          position: number;
          estimatedWaitTime?: number | null;
          admittedAt?: Date | null;
          notifiedAt?: Date | null;
          createdAt: Date;
          updatedAt: Date;
        }>;
        return result;
      }
    );

    // Update positions
    for (let i = 0; i < entriesResult.length; i++) {
      const entry = entriesResult[i];
      if (!entry) {
        continue;
      }
      const newPosition = i + 1;
      const estimatedWaitTime = await this.calculateEstimatedWaitTime(consultationId, newPosition);

      await this.databaseService.executeHealthcareWrite(
        async (client: PrismaTransactionClient) => {
          const { getWaitingRoomEntryDelegate } = await import('@core/types/video-database.types');
          const delegate = getWaitingRoomEntryDelegate(client);
          await delegate.update({
            where: { id: entry.id },
            data: {
              position: newPosition,
              estimatedWaitTime,
            },
          });
        },
        {
          userId: entry.userId,
          userRole: 'PATIENT',
          clinicId: '',
          operation: 'UPDATE_WAITING_ROOM_POSITION',
          resourceType: 'WAITING_ROOM_ENTRY',
          resourceId: entry.id,
          timestamp: new Date(),
        }
      );
    }

    // Clear cache
    await this.cacheService.delete(`waiting_room:queue:${consultationId}`);
  }

  /**
   * Notify doctor about new patient in waiting room
   */
  private async notifyDoctor(
    consultationId: string,
    doctorId: string,
    position: number
  ): Promise<void> {
    if (this.queueService) {
      await this.queueService.addJob(
        this.NOTIFICATION_QUEUE,
        'waiting_room_notification',
        {
          consultationId,
          doctorId,
          position,
          type: 'doctor',
        },
        {
          priority: 5, // NORMAL priority
          attempts: 2,
        }
      );
    }

    // Also send via Socket.IO
    this.socketService.sendToRoom(`user:${doctorId}`, 'waiting_room_notification', {
      consultationId,
      position,
      message: `New patient joined waiting room (position ${position})`,
    });
  }

  /**
   * Notify patient about admission
   */
  private async notifyPatient(userId: string, consultationId: string): Promise<void> {
    if (this.queueService) {
      await this.queueService.addJob(
        this.NOTIFICATION_QUEUE,
        'waiting_room_admission',
        {
          consultationId,
          userId,
          type: 'patient',
        },
        {
          priority: 5, // NORMAL priority
          attempts: 2,
        }
      );
    }

    // Also send via Socket.IO
    this.socketService.sendToRoom(`user:${userId}`, 'waiting_room_admission', {
      consultationId,
      message: 'You have been admitted to the consultation',
    });
  }

  /**
   * Validate waiting room is enabled
   */
  private async validateWaitingRoomEnabled(consultationId: string): Promise<{
    id: string;
    clinicId: string;
    doctorId: string;
    waitingRoomEnabled: boolean;
  }> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const { getVideoConsultationDelegate } = await import('@core/types/video-database.types');
        const delegate = getVideoConsultationDelegate(client);
        const result = await delegate.findUnique({
          where: { id: consultationId },
        });
        return result as {
          id: string;
          clinicId: string;
          doctorId: string;
          waitingRoomEnabled: boolean;
        } | null;
      }
    );

    if (!consultation) {
      throw new NotFoundException(`Consultation ${consultationId} not found`);
    }

    if (!consultation.waitingRoomEnabled) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Waiting room is not enabled for this consultation',
        undefined,
        { consultationId },
        'VideoWaitingRoomService.validateWaitingRoomEnabled'
      );
    }

    return consultation;
  }

  /**
   * Validate doctor access
   */
  private async validateDoctorAccess(
    consultationId: string,
    doctorId: string
  ): Promise<{ clinicId: string; doctorId: string }> {
    const consultation = await this.databaseService.executeHealthcareRead(
      async (client: PrismaTransactionClient) => {
        const { getVideoConsultationDelegate } = await import('@core/types/video-database.types');
        const delegate = getVideoConsultationDelegate(client);
        const result = await delegate.findUnique({
          where: { id: consultationId },
        });
        return result as {
          clinicId: string;
          doctorId: string;
        } | null;
      }
    );

    if (!consultation) {
      throw new NotFoundException(`Consultation ${consultationId} not found`);
    }

    if (consultation.doctorId !== doctorId) {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'Only the consultation doctor can admit patients',
        undefined,
        { consultationId, doctorId },
        'VideoWaitingRoomService.validateDoctorAccess'
      );
    }

    return consultation;
  }

  /**
   * Map database model to WaitingRoomEntry interface
   */
  private mapToWaitingRoomEntry(entry: {
    id: string;
    consultationId: string;
    userId: string;
    status: string;
    position: number;
    estimatedWaitTime?: number | null;
    admittedAt?: Date | null;
    notifiedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user?: {
      id: string;
      name: string;
      email: string;
      profilePicture?: string | null;
    } | null;
  }): WaitingRoomEntry {
    const result: WaitingRoomEntry = {
      id: entry.id,
      consultationId: entry.consultationId,
      userId: entry.userId,
      status: entry.status as WaitingRoomEntry['status'],
      position: entry.position,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };

    if (entry.estimatedWaitTime !== undefined && entry.estimatedWaitTime !== null) {
      result.estimatedWaitTime = entry.estimatedWaitTime;
    }
    if (entry.admittedAt) {
      result.admittedAt = entry.admittedAt;
    }
    if (entry.notifiedAt) {
      result.notifiedAt = entry.notifiedAt;
    }
    if (entry.user) {
      result.user = {
        id: entry.user.id,
        name: entry.user.name,
        email: entry.user.email,
        ...(entry.user.profilePicture && { avatar: entry.user.profilePicture }),
      };
    }

    return result;
  }
}
