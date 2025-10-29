/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "../../../../libs/infrastructure/database";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { LogType, LogLevel } from "../../../../libs/infrastructure/logging";
import {
  QueueStatus,
  TherapyType,
} from "../../../../libs/infrastructure/database/prisma/prisma.types";

// Local type definitions for Therapy Queue models
export interface TherapyQueue {
  id: string;
  clinicId: string;
  therapyType: TherapyType;
  queueName: string;
  isActive: boolean;
  maxCapacity: number;
  currentPosition: number;
  estimatedWaitTime?: number | null;
  createdAt: Date;
  updatedAt: Date;
  queueEntries?: QueueEntry[];
}

export interface QueueEntry {
  id: string;
  queueId: string;
  appointmentId: string;
  position: number;
  priority: number;
  status: QueueStatus;
  estimatedWaitTime?: number | null;
  actualWaitTime?: number | null;
  checkedInAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTherapyQueueDto {
  clinicId: string;
  therapyType: TherapyType;
  queueName: string;
  maxCapacity?: number;
}

export interface CreateQueueEntryDto {
  queueId: string;
  appointmentId: string;
  patientId: string;
  priority?: number;
  notes?: string;
}

export interface UpdateQueueEntryDto {
  position?: number;
  status?: QueueStatus;
  estimatedWaitTime?: number;
  actualWaitTime?: number;
  priority?: number;
  notes?: string;
}

export interface QueueStats {
  queueId: string;
  therapyType: string;
  totalEntries: number;
  waiting: number;
  inProgress: number;
  completed: number;
  averageWaitTime: number;
  currentCapacity: number;
  maxCapacity: number;
  utilizationRate: number;
}

@Injectable()
export class TherapyQueueService {
  private readonly logger = new Logger(TherapyQueueService.name);
  private readonly QUEUE_CACHE_TTL = 300; // 5 minutes
  private readonly STATS_CACHE_TTL = 180; // 3 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Create a new therapy queue
   */
  async createTherapyQueue(data: CreateTherapyQueueDto): Promise<TherapyQueue> {
    const startTime = Date.now();

    try {
      // Check if queue already exists for this therapy type

      const existingQueue = await this.databaseService
        .getPrismaClient()
        .therapyQueue.findFirst({
          where: {
            clinicId: data.clinicId,
            therapyType: data.therapyType,
            isActive: true,
          },
        });

      if (existingQueue) {
        throw new BadRequestException(
          `Active queue already exists for therapy type ${data.therapyType}`,
        );
      }

      const queue = await this.databaseService
        .getPrismaClient()
        .therapyQueue.create({
          data: {
            clinicId: data.clinicId,
            therapyType: data.therapyType,
            queueName: data.queueName,
            maxCapacity: data.maxCapacity || 10,
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(
        `therapy-queues:clinic:${data.clinicId}*`,
      );

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Therapy queue created successfully",
        "TherapyQueueService",
        {
          queueId: queue.id,
          therapyType: data.therapyType,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        },
      );

      return queue;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy queue: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get all queues for a clinic
   */
  async getClinicQueues(
    clinicId: string,
    isActive?: boolean,
  ): Promise<TherapyQueue[]> {
    const startTime = Date.now();
    const cacheKey = `therapy-queues:clinic:${clinicId}:${isActive ?? "all"}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const queues = await this.databaseService
        .getPrismaClient()
        .therapyQueue.findMany({
          where: {
            clinicId,
            ...(isActive !== undefined && { isActive }),
          },
          include: {
            queueEntries: {
              where: {
                status: {
                  in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                },
              },
              orderBy: { position: "asc" },
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        email: true,
                        phone: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(queues),
        this.QUEUE_CACHE_TTL,
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Clinic therapy queues retrieved successfully",
        "TherapyQueueService",
        {
          clinicId,
          count: queues.length,
          responseTime: Date.now() - startTime,
        },
      );

      return queues;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic queues: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get queue by therapy type
   */
  async getQueueByTherapyType(
    clinicId: string,
    therapyType: TherapyType,
  ): Promise<TherapyQueue> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue:clinic:${clinicId}:type:${therapyType}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const queue = await this.databaseService
        .getPrismaClient()
        .therapyQueue.findFirst({
          where: {
            clinicId,
            therapyType,
            isActive: true,
          },
          include: {
            queueEntries: {
              where: {
                status: {
                  in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                },
              },
              orderBy: { position: "asc" },
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        email: true,
                        phone: true,
                      },
                    },
                  },
                },
                appointment: {
                  select: {
                    id: true,
                    type: true,
                    date: true,
                    time: true,
                  },
                },
              },
            },
          },
        });

      if (!queue) {
        throw new NotFoundException(
          `No active queue found for therapy type ${therapyType}`,
        );
      }

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(queue),
        this.QUEUE_CACHE_TTL,
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Therapy queue retrieved by type",
        "TherapyQueueService",
        {
          clinicId,
          therapyType,
          entriesCount: queue.queueEntries.length,
          responseTime: Date.now() - startTime,
        },
      );

      return queue;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue by therapy type: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          clinicId,
          therapyType,
          error: error instanceof Error ? error.stack : undefined,
        },
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
      // Get the queue to check capacity

      const queue = await this.databaseService
        .getPrismaClient()
        .therapyQueue.findUnique({
          where: { id: data.queueId },
          include: {
            queueEntries: {
              where: {
                status: {
                  in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                },
              },
            },
          },
        });

      if (!queue) {
        throw new NotFoundException(`Queue with ID ${data.queueId} not found`);
      }

      if (!queue.isActive) {
        throw new BadRequestException("Queue is not active");
      }

      // Check capacity
      if (queue.queueEntries.length >= queue.maxCapacity) {
        throw new BadRequestException("Queue is at maximum capacity");
      }

      // Check if patient already in queue

      const existingEntry = await this.databaseService
        .getPrismaClient()
        .queueEntry.findFirst({
          where: {
            queueId: data.queueId,
            patientId: data.patientId,
            status: {
              in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
            },
          },
        });

      if (existingEntry) {
        throw new BadRequestException("Patient is already in the queue");
      }

      // Calculate position based on priority
      const position = await this.calculatePosition(
        data.queueId,
        data.priority || 0,
      );

      // Calculate estimated wait time
      const estimatedWaitTime = this.calculateEstimatedWaitTime(
        position,
        queue.therapyType,
      );

      const entry = await this.databaseService
        .getPrismaClient()
        .queueEntry.create({
          data: {
            queueId: data.queueId,
            appointmentId: data.appointmentId,
            patientId: data.patientId,
            position,
            priority: data.priority || 0,
            estimatedWaitTime,
            notes: data.notes,
            status: QueueStatus.WAITING,
          },
          include: {
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: true,
          },
        });

      // Update queue current position

      await this.databaseService.getPrismaClient().therapyQueue.update({
        where: { id: data.queueId },
        data: {
          currentPosition: queue.currentPosition + 1,
        },
      });

      // Invalidate cache
      await this.invalidateQueueCache(queue.clinicId, data.queueId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Patient added to therapy queue",
        "TherapyQueueService",
        {
          entryId: entry.id,
          queueId: data.queueId,
          patientId: data.patientId,
          position,
          responseTime: Date.now() - startTime,
        },
      );

      return entry;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to add to queue: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Update queue entry
   */
  async updateQueueEntry(
    entryId: string,
    data: UpdateQueueEntryDto,
  ): Promise<QueueEntry> {
    const startTime = Date.now();

    try {
      const entry = await this.databaseService
        .getPrismaClient()
        .queueEntry.update({
          where: { id: entryId },
          data,
          include: {
            queue: true,
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: true,
          },
        });

      // Invalidate cache
      await this.invalidateQueueCache(entry.queue.clinicId, entry.queueId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Queue entry updated successfully",
        "TherapyQueueService",
        {
          entryId,
          status: data.status,
          responseTime: Date.now() - startTime,
        },
      );

      return entry;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update queue entry: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          entryId,
          error: error instanceof Error ? error.stack : undefined,
        },
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
  async completeQueueEntry(
    entryId: string,
    actualWaitTime?: number,
  ): Promise<QueueEntry> {
    const entry = await this.databaseService
      .getPrismaClient()
      .queueEntry.findUnique({
        where: { id: entryId },
      });

    if (!entry) {
      throw new NotFoundException(`Queue entry with ID ${entryId} not found`);
    }

    // Calculate actual wait time if not provided
    let waitTime = actualWaitTime;
    if (!waitTime && entry.checkedInAt) {
      const checkedInTime = new Date(entry.checkedInAt).getTime();
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
      const entry = await this.databaseService
        .getPrismaClient()
        .queueEntry.findUnique({
          where: { id: entryId },
          include: { queue: true },
        });

      if (!entry) {
        throw new NotFoundException(`Queue entry with ID ${entryId} not found`);
      }

      await this.databaseService.getPrismaClient().queueEntry.delete({
        where: { id: entryId },
      });

      // Reorder remaining entries
      await this.reorderQueue(entry.queueId);

      // Invalidate cache
      await this.invalidateQueueCache(entry.queue.clinicId, entry.queueId);

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Patient removed from queue",
        "TherapyQueueService",
        {
          entryId,
          queueId: entry.queueId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to remove from queue: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          entryId,
          error: error instanceof Error ? error.stack : undefined,
        },
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
      const entry = await this.databaseService
        .getPrismaClient()
        .queueEntry.findFirst({
          where: {
            appointmentId,
            status: {
              in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
            },
          },
          include: {
            queue: {
              include: {
                queueEntries: {
                  where: {
                    status: {
                      in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
                    },
                  },
                },
              },
            },
          },
        });

      if (!entry) {
        throw new NotFoundException("Patient not found in any queue");
      }

      const result = {
        position: entry.position,
        totalInQueue: entry.queue.queueEntries.length,
        estimatedWaitTime: entry.estimatedWaitTime || 0,
        status: entry.status,
      };

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Patient queue position retrieved",
        "TherapyQueueService",
        {
          appointmentId,
          position: result.position,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          appointmentId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueId: string): Promise<QueueStats> {
    const startTime = Date.now();
    const cacheKey = `therapy-queue-stats:${queueId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const queue = await this.databaseService
        .getPrismaClient()
        .therapyQueue.findUnique({
          where: { id: queueId },
          include: {
            queueEntries: true,
          },
        });

      if (!queue) {
        throw new NotFoundException(`Queue with ID ${queueId} not found`);
      }

      type QueueEntryWithStatus = {
        status: QueueStatus;
        actualWaitTime?: number | null;
      };
      const entries = queue.queueEntries as QueueEntryWithStatus[];
      const waiting = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.WAITING,
      ).length;
      const inProgress = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.IN_PROGRESS,
      ).length;
      const completed = entries.filter(
        (e: QueueEntryWithStatus) => e.status === QueueStatus.COMPLETED,
      ).length;

      // Calculate average wait time for completed entries
      const completedEntries = entries.filter(
        (e: QueueEntryWithStatus) =>
          e.status === QueueStatus.COMPLETED && e.actualWaitTime,
      );
      const averageWaitTime =
        completedEntries.length > 0
          ? completedEntries.reduce(
              (sum: number, e: { actualWaitTime?: number | null }) =>
                sum + (e.actualWaitTime || 0),
              0,
            ) / completedEntries.length
          : 0;

      const currentCapacity = waiting + inProgress;
      const utilizationRate = (currentCapacity / queue.maxCapacity) * 100;

      const stats: QueueStats = {
        queueId: queue.id,
        therapyType: queue.therapyType,
        totalEntries: entries.length,
        waiting,
        inProgress,
        completed,
        averageWaitTime: Math.round(averageWaitTime),
        currentCapacity,
        maxCapacity: queue.maxCapacity,
        utilizationRate: Math.round(utilizationRate),
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(stats),
        this.STATS_CACHE_TTL,
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Queue stats retrieved successfully",
        "TherapyQueueService",
        {
          queueId,
          stats,
          responseTime: Date.now() - startTime,
        },
      );

      return stats;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue stats: ${error instanceof Error ? error.message : String(error)}`,
        "TherapyQueueService",
        {
          queueId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Reorder queue entries
   */
  async reorderQueue(queueId: string): Promise<void> {
    const entries = await this.databaseService
      .getPrismaClient()
      .queueEntry.findMany({
        where: {
          queueId,
          status: {
            in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
          },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

    // Update positions
    for (let i = 0; i < entries.length; i++) {
      await this.databaseService.getPrismaClient().queueEntry.update({
        where: { id: entries[i].id },
        data: { position: i + 1 },
      });
    }
  }

  /**
   * Calculate position in queue based on priority
   */
  private async calculatePosition(
    queueId: string,
    priority: number,
  ): Promise<number> {
    const entries = await this.databaseService
      .getPrismaClient()
      .queueEntry.findMany({
        where: {
          queueId,
          status: {
            in: [QueueStatus.WAITING, QueueStatus.IN_PROGRESS],
          },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      });

    // Find position based on priority
    let position = entries.length + 1;
    for (let i = 0; i < entries.length; i++) {
      if (priority > entries[i].priority) {
        position = i + 1;
        // Update positions of entries after this one
        for (let j = i; j < entries.length; j++) {
          await this.databaseService.getPrismaClient().queueEntry.update({
            where: { id: entries[j].id },
            data: { position: j + 2 },
          });
        }
        break;
      }
    }

    return position;
  }

  /**
   * Calculate estimated wait time
   */
  private calculateEstimatedWaitTime(
    position: number,
    therapyType: TherapyType,
  ): number {
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
  private async invalidateQueueCache(
    clinicId: string,
    queueId: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.invalidateByPattern(
        `therapy-queues:clinic:${clinicId}*`,
      ),
      this.cacheService.invalidateByPattern(`therapy-queue:*:${queueId}*`),
      this.cacheService.del(`therapy-queue-stats:${queueId}`),
    ]);
  }
}
/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
