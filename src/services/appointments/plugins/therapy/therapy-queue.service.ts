import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { QueueStatus, TherapyType } from '@core/types/enums.types';
import type {
  TherapyQueue,
  QueueEntry,
  CreateTherapyQueueDto,
  CreateQueueEntryDto,
  UpdateQueueEntryDto,
} from '@core/types/appointment.types';
import type { TherapyQueueStats } from '@core/types/appointment.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';

// Re-export types for backward compatibility
export type {
  TherapyQueue,
  QueueEntry,
  CreateTherapyQueueDto,
  CreateQueueEntryDto,
  UpdateQueueEntryDto,
  TherapyQueueStats as QueueStats,
};

@Injectable()
export class TherapyQueueService {
  private readonly logger = new Logger(TherapyQueueService.name);
  private readonly QUEUE_CACHE_TTL = 300; // 5 minutes
  private readonly STATS_CACHE_TTL = 180; // 3 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Create a new therapy queue
   */
  async createTherapyQueue(data: CreateTherapyQueueDto): Promise<TherapyQueue> {
    const startTime = Date.now();

    try {
      // Check if queue already exists for this therapy type using executeHealthcareRead
      const existingQueue = await this.databaseService.executeHealthcareRead<TherapyQueue | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.findFirst({
            where: {
              clinicId: data.clinicId,
              therapyType: data.therapyType as TherapyType,
              isActive: true,
            } as PrismaDelegateArgs,
          });
        }
      );

      if (existingQueue) {
        throw new BadRequestException(
          `Active queue already exists for therapy type ${data.therapyType}`
        );
      }

      // Use executeHealthcareWrite for create operation
      const queue = await this.databaseService.executeHealthcareWrite<TherapyQueue>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.create({
            data: {
              clinicId: data.clinicId,
              therapyType: data.therapyType as TherapyType,
              queueName: data.queueName,
              maxCapacity: data.maxCapacity || 10,
            } as PrismaDelegateArgs,
          });
        },
        {
          userId: 'system',
          clinicId: data.clinicId,
          resourceType: 'THERAPY_QUEUE',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { therapyType: data.therapyType, queueName: data.queueName },
        }
      );

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`therapy-queues:clinic:${data.clinicId}*`);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Therapy queue created successfully',
        'TherapyQueueService',
        {
          queueId: queue.id,
          therapyType: data.therapyType,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return queue;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy queue: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get all queues for a clinic
   */
  async getClinicQueues(clinicId: string, isActive?: boolean): Promise<TherapyQueue[]> {
    const startTime = Date.now();
    const cacheKey = `therapy-queues:clinic:${clinicId}:${isActive ?? 'all'}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as TherapyQueue[];
      }

      // Use executeHealthcareRead with client parameter
      const queues = await this.databaseService.executeHealthcareRead<TherapyQueue[]>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.findMany({
            where: {
              clinicId,
              ...(isActive !== undefined && { isActive }),
            } as PrismaDelegateArgs,
            include: {
              queueEntries: {
                where: {
                  status: {
                    in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                  },
                } as PrismaDelegateArgs,
                orderBy: { position: 'asc' } as PrismaDelegateArgs,
                include: {
                  patient: {
                    include: {
                      user: {
                        select: {
                          name: true,
                          email: true,
                          phone: true,
                        } as PrismaDelegateArgs,
                      } as PrismaDelegateArgs,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
            orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(queues), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic therapy queues retrieved successfully',
        'TherapyQueueService',
        {
          clinicId,
          count: queues.length,
          responseTime: Date.now() - startTime,
        }
      );

      return queues;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic queues: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get queue by therapy type
   */
  async getQueueByTherapyType(clinicId: string, therapyType: TherapyType): Promise<TherapyQueue> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue:clinic:${clinicId}:type:${therapyType}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as TherapyQueue;
      }

      // Use executeHealthcareRead with client parameter
      const queue = await this.databaseService.executeHealthcareRead<TherapyQueue | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.findFirst({
            where: {
              clinicId,
              therapyType,
              isActive: true,
            } as PrismaDelegateArgs,
            include: {
              queueEntries: {
                where: {
                  status: {
                    in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                  },
                } as PrismaDelegateArgs,
                orderBy: { position: 'asc' } as PrismaDelegateArgs,
                include: {
                  patient: {
                    include: {
                      user: {
                        select: {
                          name: true,
                          email: true,
                          phone: true,
                        } as PrismaDelegateArgs,
                      } as PrismaDelegateArgs,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                  appointment: {
                    select: {
                      id: true,
                      type: true,
                      date: true,
                      time: true,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );

      if (!queue) {
        throw new NotFoundException(`No active queue found for therapy type ${therapyType}`);
      }

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(queue), this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Therapy queue retrieved by type',
        'TherapyQueueService',
        {
          clinicId,
          therapyType,
          entriesCount: queue.queueEntries?.length || 0,
          responseTime: Date.now() - startTime,
        }
      );

      return queue;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue by therapy type: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          clinicId,
          therapyType,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Add patient to therapy queue
   */
  async addToQueue(data: CreateQueueEntryDto): Promise<QueueEntry> {
    const startTime = Date.now();

    try {
      // Get the queue to check capacity using executeHealthcareRead
      const queue = await this.databaseService.executeHealthcareRead<TherapyQueue | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.findUnique({
            where: { id: data.queueId } as PrismaDelegateArgs,
            include: {
              queueEntries: {
                where: {
                  status: {
                    in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                  },
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );

      if (!queue) {
        throw new NotFoundException(`Queue with ID ${data.queueId} not found`);
      }

      if (!queue.isActive) {
        throw new BadRequestException('Queue is not active');
      }

      // Check capacity
      const queueWithEntries = queue as TherapyQueue & {
        queueEntries: QueueEntry[];
        maxCapacity: number;
        currentPosition: number;
        therapyType: TherapyType;
      };
      if (queueWithEntries.queueEntries.length >= queueWithEntries.maxCapacity) {
        throw new BadRequestException('Queue is at maximum capacity');
      }

      // Check if patient already in queue using executeHealthcareRead
      const existingEntry = await this.databaseService.executeHealthcareRead<QueueEntry | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.queueEntry.findFirst({
            where: {
              queueId: data.queueId,
              patientId: data.patientId,
              status: {
                in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );

      if (existingEntry) {
        throw new BadRequestException('Patient is already in the queue');
      }

      // Calculate position based on priority
      const position = await this.calculatePosition(data.queueId, data.priority || 0);

      // Calculate estimated wait time
      const estimatedWaitTime = this.calculateEstimatedWaitTime(
        position,
        queueWithEntries.therapyType
      );

      // Use executeHealthcareWrite for create operation
      const entry = await this.databaseService.executeHealthcareWrite<QueueEntry>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.queueEntry.create({
            data: {
              queueId: data.queueId,
              appointmentId: data.appointmentId,
              patientId: data.patientId,
              position,
              priority: data.priority || 0,
              estimatedWaitTime,
              notes: data.notes ?? null,
              status: QueueStatus.WAITING,
            } as PrismaDelegateArgs,
            include: {
              patient: {
                include: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                      phone: true,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              appointment: true,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: 'system',
          clinicId: (queue as { clinicId: string }).clinicId,
          resourceType: 'QUEUE_ENTRY',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { queueId: data.queueId, patientId: data.patientId },
        }
      );

      // Update queue current position using executeHealthcareWrite
      await this.databaseService.executeHealthcareWrite<TherapyQueue>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.therapyQueue.update({
            where: { id: data.queueId } as PrismaDelegateArgs,
            data: {
              currentPosition: queueWithEntries.currentPosition + 1,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: 'system',
          clinicId: (queue as { clinicId: string }).clinicId,
          resourceType: 'THERAPY_QUEUE',
          operation: 'UPDATE',
          resourceId: data.queueId,
          userRole: 'system',
          details: { updatedField: 'currentPosition' },
        }
      );

      // Invalidate cache
      await this.invalidateQueueCache((queue as { clinicId: string }).clinicId, data.queueId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Patient added to therapy queue',
        'TherapyQueueService',
        {
          entryId: entry.id,
          queueId: data.queueId,
          patientId: data.patientId,
          position,
          responseTime: Date.now() - startTime,
        }
      );

      return entry;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to add to queue: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Update queue entry
   */
  async updateQueueEntry(entryId: string, data: UpdateQueueEntryDto): Promise<QueueEntry> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareWrite for update operation
      const entry = await this.databaseService.executeHealthcareWrite<
        QueueEntry & { queue: TherapyQueue }
      >(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return (await typedClient.queueEntry.update({
            where: { id: entryId } as PrismaDelegateArgs,
            data: {
              ...(data.position !== undefined && { position: data.position }),
              ...(data.status !== undefined && { status: data.status as QueueStatus }),
              ...(data.estimatedWaitTime !== undefined && {
                estimatedWaitTime: data.estimatedWaitTime,
              }),
              ...(data.actualWaitTime !== undefined && { actualWaitTime: data.actualWaitTime }),
              ...(data.priority !== undefined && { priority: data.priority }),
              ...(data.notes !== undefined && { notes: data.notes ?? null }),
            } as PrismaDelegateArgs,
            include: {
              queue: true,
              patient: {
                include: {
                  user: {
                    select: {
                      name: true,
                      email: true,
                      phone: true,
                    } as PrismaDelegateArgs,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              appointment: true,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as QueueEntry & { queue: TherapyQueue };
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'QUEUE_ENTRY',
          operation: 'UPDATE',
          resourceId: entryId,
          userRole: 'system',
          details: { updates: Object.keys(data) },
        }
      );

      // Invalidate cache
      const typedEntry = entry as QueueEntry & { queue: TherapyQueue };
      const clinicId = typedEntry.queue.clinicId;
      await this.invalidateQueueCache(clinicId, typedEntry.queueId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Queue entry updated successfully',
        'TherapyQueueService',
        {
          entryId,
          status: data.status,
          responseTime: Date.now() - startTime,
        }
      );

      const { queue: _queue, ...entryWithoutQueue } = typedEntry;
      return entryWithoutQueue as QueueEntry;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update queue entry: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          entryId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Start processing queue entry
   */
  async startQueueEntry(entryId: string): Promise<QueueEntry> {
    return this.updateQueueEntry(entryId, {
      status: QueueStatus.IN_PROGRESS,
    });
  }

  /**
   * Complete queue entry
   */
  async completeQueueEntry(entryId: string, actualWaitTime?: number): Promise<QueueEntry> {
    // Use executeHealthcareRead with client parameter
    const entry = await this.databaseService.executeHealthcareRead<QueueEntry | null>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.queueEntry.findUnique({
          where: { id: entryId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );

    if (!entry) {
      throw new NotFoundException(`Queue entry with ID ${entryId} not found`);
    }

    // Calculate actual wait time if not provided
    let waitTime = actualWaitTime;
    const entryWithCheckedIn = entry as QueueEntry & { checkedInAt?: Date | string };
    if (!waitTime && entryWithCheckedIn.checkedInAt) {
      const checkedInTime = new Date(entryWithCheckedIn.checkedInAt).getTime();
      const currentTime = Date.now();
      waitTime = Math.floor((currentTime - checkedInTime) / (1000 * 60)); // minutes
    }

    return this.updateQueueEntry(entryId, {
      status: QueueStatus.COMPLETED,
      ...(waitTime !== undefined && { actualWaitTime: waitTime }),
    });
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(entryId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareRead to get entry with queue info
      const entry = (await this.databaseService.executeHealthcareRead<
        (QueueEntry & { queue: TherapyQueue }) | null
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.queueEntry.findUnique({
          where: { id: entryId } as PrismaDelegateArgs,
          include: { queue: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as (QueueEntry & { queue: TherapyQueue }) | null;
      })) as (QueueEntry & { queue: TherapyQueue }) | null;

      if (!entry) {
        throw new NotFoundException(`Queue entry with ID ${entryId} not found`);
      }

      const queueId = entry.queueId;
      const clinicId = entry.queue.clinicId;

      // Use executeHealthcareWrite for delete operation
      await this.databaseService.executeHealthcareWrite<QueueEntry>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.queueEntry.delete({
            where: { id: entryId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: 'system',
          clinicId,
          resourceType: 'QUEUE_ENTRY',
          operation: 'DELETE',
          resourceId: entryId,
          userRole: 'system',
          details: {},
        }
      );

      // Reorder remaining entries
      await this.reorderQueue(queueId);

      // Invalidate cache
      if (clinicId) {
        await this.invalidateQueueCache(clinicId, queueId);
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Patient removed from queue',
        'TherapyQueueService',
        {
          entryId,
          queueId: entry.queueId,
          responseTime: Date.now() - startTime,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to remove from queue: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          entryId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get patient position in queue
   */
  async getPatientQueuePosition(appointmentId: string): Promise<{
    position: number;
    totalInQueue: number;
    estimatedWaitTime: number;
    status: QueueStatus;
  }> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareRead with client parameter
      const entry = (await this.databaseService.executeHealthcareRead<
        | (QueueEntry & {
            queue: TherapyQueue & { queueEntries: QueueEntry[] };
            position: number;
            estimatedWaitTime?: number | null;
            status: string;
          })
        | null
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.queueEntry.findFirst({
          where: {
            appointmentId,
            status: {
              in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
            },
          } as PrismaDelegateArgs,
          include: {
            queue: {
              include: {
                queueEntries: {
                  where: {
                    status: {
                      in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                    },
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as
          | (QueueEntry & {
              queue: TherapyQueue & { queueEntries: QueueEntry[] };
              position: number;
              estimatedWaitTime?: number | null;
              status: string;
            })
          | null;
      })) as
        | (QueueEntry & {
            queue: TherapyQueue & { queueEntries: QueueEntry[] };
            position: number;
            estimatedWaitTime?: number | null;
            status: string;
          })
        | null;

      if (!entry) {
        throw new NotFoundException('Patient not found in any queue');
      }

      const typedEntry = entry as QueueEntry & {
        queue: TherapyQueue & { queueEntries: QueueEntry[] };
        position: number;
        estimatedWaitTime?: number | null;
        status: string;
      };
      const result = {
        position: typedEntry.position,
        totalInQueue: typedEntry.queue.queueEntries.length,
        estimatedWaitTime: typedEntry.estimatedWaitTime || 0,
        status: typedEntry.status as QueueStatus,
      };

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved',
        'TherapyQueueService',
        {
          appointmentId,
          position: result.position,
          responseTime: Date.now() - startTime,
        }
      );

      return result as {
        position: number;
        totalInQueue: number;
        estimatedWaitTime: number;
        status: QueueStatus;
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          appointmentId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueId: string): Promise<TherapyQueueStats> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue-stats:${queueId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as TherapyQueueStats;
      }

      // Use executeHealthcareRead with client parameter
      const queue = (await this.databaseService.executeHealthcareRead<
        (TherapyQueue & { queueEntries: QueueEntry[] }) | null
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.therapyQueue.findUnique({
          where: { id: queueId } as PrismaDelegateArgs,
          include: {
            queueEntries: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as (TherapyQueue & { queueEntries: QueueEntry[] }) | null;
      })) as (TherapyQueue & { queueEntries: QueueEntry[] }) | null;

      if (!queue) {
        throw new NotFoundException(`Queue with ID ${queueId} not found`);
      }

      type QueueEntryWithStatus = {
        status: QueueStatus;
        actualWaitTime?: number | null;
      };
      const typedQueue = queue as TherapyQueue & { queueEntries: QueueEntry[] };
      const entries = typedQueue.queueEntries as QueueEntryWithStatus[];
      const waiting = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.WAITING
      ).length;
      const inProgress = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.IN_PROGRESS
      ).length;
      const completed = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.COMPLETED
      ).length;

      // Calculate average wait time for completed entries
      const completedEntries = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.COMPLETED && e.actualWaitTime
      );
      const averageWaitTime =
        completedEntries.length > 0
          ? completedEntries.reduce(
              (sum: number, e: { actualWaitTime?: number | null }) => sum + (e.actualWaitTime || 0),
              0
            ) / completedEntries.length
          : 0;

      const currentCapacity = waiting + inProgress;
      const utilizationRate = (currentCapacity / typedQueue.maxCapacity) * 100;

      const stats: TherapyQueueStats = {
        queueId: typedQueue.id,
        therapyType: typedQueue.therapyType,
        totalEntries: entries.length,
        waiting,
        inProgress,
        completed,
        averageWaitTime: Math.round(averageWaitTime),
        currentCapacity,
        maxCapacity: typedQueue.maxCapacity,
        utilizationRate: Math.round(utilizationRate),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(stats), this.STATS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue stats retrieved successfully',
        'TherapyQueueService',
        {
          queueId,
          stats,
          responseTime: Date.now() - startTime,
        }
      );

      return stats;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue stats: ${error instanceof Error ? error.message : String(error)}`,
        'TherapyQueueService',
        {
          queueId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Reorder queue entries
   */
  async reorderQueue(queueId: string): Promise<void> {
    // Use executeHealthcareRead to get entries
    const entries = await this.databaseService.executeHealthcareRead<QueueEntry[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.queueEntry.findMany({
        where: {
          queueId,
          status: {
            in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
          },
        } as PrismaDelegateArgs,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] as unknown as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    // Update positions using executeHealthcareWrite
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      await this.databaseService.executeHealthcareWrite<QueueEntry>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.queueEntry.update({
            where: { id: entry.id } as PrismaDelegateArgs,
            data: { position: i + 1 } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'QUEUE_ENTRY',
          operation: 'UPDATE',
          resourceId: entry.id,
          userRole: 'system',
          details: { updatedField: 'position', newPosition: i + 1 },
        }
      );
    }
  }

  /**
   * Calculate position in queue based on priority
   */
  private async calculatePosition(queueId: string, priority: number): Promise<number> {
    // Use executeHealthcareRead to get entries
    const entries = await this.databaseService.executeHealthcareRead<QueueEntry[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.queueEntry.findMany({
        where: {
          queueId,
          status: {
            in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
          },
        } as PrismaDelegateArgs,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] as unknown as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    // Find position based on priority
    let position = entries.length + 1;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const typedEntry = entry as QueueEntry & { priority: number };
      if (priority > typedEntry.priority) {
        position = i + 1;
        // Update positions of entries after this one using executeHealthcareWrite
        for (let j = i; j < entries.length; j++) {
          const entryToUpdate = entries[j];
          if (!entryToUpdate) continue;
          await this.databaseService.executeHealthcareWrite<QueueEntry>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              return await typedClient.queueEntry.update({
                where: { id: entryToUpdate.id } as PrismaDelegateArgs,
                data: { position: j + 2 } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            },
            {
              userId: 'system',
              clinicId: '',
              resourceType: 'QUEUE_ENTRY',
              operation: 'UPDATE',
              resourceId: entryToUpdate.id,
              userRole: 'system',
              details: { updatedField: 'position', newPosition: j + 2 },
            }
          );
        }
        break;
      }
    }

    return position;
  }

  /**
   * Calculate estimated wait time
   */
  private calculateEstimatedWaitTime(position: number, therapyType: TherapyType): number {
    // Base wait time varies by therapy type
    const baseWaitTimes: Record<TherapyType, number> = {
      [TherapyType.SHODHANA]: 30, // Purification therapies
      [TherapyType.SHAMANA]: 20, // Palliative therapies
      [TherapyType.RASAYANA]: 25, // Rejuvenation therapies
      [TherapyType.VAJIKARANA]: 25, // Aphrodisiac therapies
    };

    const baseWaitTime = baseWaitTimes[therapyType] || 20;
    return position * baseWaitTime;
  }

  /**
   * Invalidate queue-related cache
   */
  private async invalidateQueueCache(clinicId: string, queueId: string): Promise<void> {
    await Promise.all([
      this.cacheService.invalidateByPattern(`therapy-queues:clinic:${clinicId}*`),
      this.cacheService.invalidateByPattern(`therapy-queue:*:${queueId}*`),
      this.cacheService.del(`therapy-queue-stats:${queueId}`),
    ]);
  }
}
