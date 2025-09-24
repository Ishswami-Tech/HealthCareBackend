import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { LogType, LogLevel } from "../../../../libs/infrastructure/logging";

export interface QueueEntry {
  id: string;
  appointmentId: string;
  position: number;
  estimatedWaitTime: number;
  status: "WAITING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  queueNumber?: number;
  priority?: number;
  actualWaitTime?: number;
  checkedInAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface QueueMetrics {
  totalWaiting: number;
  averageWaitTime: number;
  efficiency: number;
  utilization: number;
  estimatedNextWaitTime: number;
}

@Injectable()
export class AppointmentQueueService {
  private readonly logger = new Logger(AppointmentQueueService.name);
  private readonly QUEUE_CACHE_TTL = 3600; // 1 hour
  private readonly METRICS_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  async getDoctorQueue(
    doctorId: string,
    date: string,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:doctor:${doctorId}:${date}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          "Doctor queue retrieved from cache",
          "AppointmentQueueService",
          { doctorId, date, domain, responseTime: Date.now() - startTime },
        );
        return JSON.parse(cached as string);
      }

      // Get queue from Redis
      const queueKey = `queue:${domain}:${doctorId}:${date}`;
      const queueEntries = await this.cacheService.lRange(queueKey, 0, -1);

      const queue = await Promise.all(
        queueEntries.map(async (entry, index) => {
          const entryData = JSON.parse(entry);
          return {
            ...entryData,
            position: index + 1,
            estimatedWaitTime: this.calculateEstimatedWaitTime(
              index + 1,
              domain,
            ),
          };
        }),
      );

      const result = {
        doctorId,
        date,
        domain,
        queue,
        totalLength: queue.length,
        averageWaitTime: this.calculateAverageWaitTime(queue),
        estimatedNextWaitTime:
          queue.length > 0 ? this.calculateEstimatedWaitTime(1, domain) : 0,
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.QUEUE_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Doctor queue retrieved successfully",
        "AppointmentQueueService",
        {
          doctorId,
          date,
          domain,
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor queue: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          doctorId,
          date,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getPatientQueuePosition(
    appointmentId: string,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:position:${appointmentId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Find appointment in all doctor queues
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      let position = -1;
      let doctorId = "";
      let queueKey = "";

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex((entry) => {
          const entryData = JSON.parse(entry);
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          position = entryIndex + 1;
          doctorId = key.split(":")[2];
          queueKey = key;
          break;
        }
      }

      if (position === -1) {
        throw new Error("Appointment not found in any queue");
      }

      const estimatedWaitTime = this.calculateEstimatedWaitTime(
        position,
        domain,
      );
      const totalInQueue = await this.cacheService.lLen(queueKey);

      const result = {
        appointmentId,
        position,
        totalInQueue,
        estimatedWaitTime,
        domain,
        doctorId,
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(cacheKey, JSON.stringify(result), 60);

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Patient queue position retrieved successfully",
        "AppointmentQueueService",
        {
          appointmentId,
          domain,
          position,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          appointmentId,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async confirmAppointment(
    appointmentId: string,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      // Find and update appointment in queue
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex((entry) => {
          const entryData = JSON.parse(entry);
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          const entryData = JSON.parse(entries[entryIndex]);
          entryData.status = "CONFIRMED";
          entryData.confirmedAt = new Date().toISOString();

          // Update the entry in the queue
          await this.cacheService.set(
            `${key}:${entryIndex}`,
            JSON.stringify(entryData),
            this.QUEUE_CACHE_TTL,
          );

          this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            "Appointment confirmed in queue",
            "AppointmentQueueService",
            { appointmentId, domain, responseTime: Date.now() - startTime },
          );

          return { success: true, message: "Appointment confirmed" };
        }
      }

      throw new Error("Appointment not found in queue");
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          appointmentId,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async startConsultation(
    appointmentId: string,
    doctorId: string,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      const queueKey = `queue:${domain}:${doctorId}:${new Date().toISOString().split("T")[0]}`;
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      const entryIndex = entries.findIndex((entry) => {
        const entryData = JSON.parse(entry);
        return entryData.appointmentId === appointmentId;
      });

      if (entryIndex === -1) {
        throw new Error("Appointment not found in queue");
      }

      const entryData = JSON.parse(entries[entryIndex]);
      entryData.status = "IN_PROGRESS";
      entryData.startedAt = new Date().toISOString();
      entryData.actualWaitTime = this.calculateActualWaitTime(
        entryData.checkedInAt,
      );

      // Update the entry in the queue
      await this.cacheService.set(
        `${queueKey}:${entryIndex}`,
        JSON.stringify(entryData),
        this.QUEUE_CACHE_TTL,
      );

      // Invalidate cache
      await this.cacheService.del(
        `queue:doctor:${doctorId}:${new Date().toISOString().split("T")[0]}:${domain}`,
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Consultation started",
        "AppointmentQueueService",
        {
          appointmentId,
          doctorId,
          domain,
          responseTime: Date.now() - startTime,
        },
      );

      return { success: true, message: "Consultation started" };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          appointmentId,
          doctorId,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async reorderQueue(reorderData: any, domain: string): Promise<any> {
    const startTime = Date.now();

    try {
      const { doctorId, date, newOrder } = reorderData;
      const queueKey = `queue:${domain}:${doctorId}:${date}`;

      // Get current queue
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      // Reorder based on new order
      const reorderedEntries = newOrder
        .map((appointmentId: string) => {
          return entries.find((entry) => {
            const entryData = JSON.parse(entry);
            return entryData.appointmentId === appointmentId;
          });
        })
        .filter(Boolean);

      // Clear and repopulate queue
      await this.cacheService.del(queueKey);
      for (const entry of reorderedEntries) {
        await this.cacheService.rPush(queueKey, entry as string);
      }

      // Invalidate cache
      await this.cacheService.del(`queue:doctor:${doctorId}:${date}:${domain}`);

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Queue reordered successfully",
        "AppointmentQueueService",
        {
          doctorId,
          date,
          domain,
          newOrderLength: newOrder.length,
          responseTime: Date.now() - startTime,
        },
      );

      return { success: true, message: "Queue reordered successfully" };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          reorderData,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getLocationQueueStats(
    locationId: string,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:stats:location:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get all queues for the location
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      let totalWaiting = 0;
      let totalWaitTime = 0;
      let completedCount = 0;

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);

        for (const entry of entries) {
          const entryData = JSON.parse(entry);
          if (entryData.locationId === locationId) {
            if (entryData.status === "WAITING") {
              totalWaiting++;
              totalWaitTime += entryData.estimatedWaitTime || 0;
            } else if (entryData.status === "COMPLETED") {
              completedCount++;
            }
          }
        }
      }

      const averageWaitTime =
        totalWaiting > 0 ? totalWaitTime / totalWaiting : 0;
      const efficiency =
        completedCount > 0
          ? (completedCount / (completedCount + totalWaiting)) * 100
          : 0;
      const utilization =
        totalWaiting > 0 ? Math.min((totalWaiting / 50) * 100, 100) : 0; // Assuming max capacity of 50

      const result = {
        locationId,
        domain,
        stats: {
          totalWaiting,
          averageWaitTime,
          efficiency,
          utilization,
          completedCount,
        },
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(result),
        this.METRICS_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Location queue stats retrieved successfully",
        "AppointmentQueueService",
        {
          locationId,
          domain,
          totalWaiting,
          responseTime: Date.now() - startTime,
        },
      );

      return result;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue stats: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          locationId,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async getQueueMetrics(
    locationId: string,
    domain: string,
    period: string,
  ): Promise<any> {
    const startTime = Date.now();
    const cacheKey = `queue:metrics:${locationId}:${domain}:${period}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Calculate metrics based on period
      const stats = await this.getLocationQueueStats(locationId, domain);

      // Add period-specific calculations
      const metrics = {
        ...stats,
        period,
        metrics: {
          efficiency: stats.stats.efficiency,
          utilization: stats.stats.utilization,
          throughput: this.calculateThroughput(domain, period),
          responseTime: this.calculateAverageResponseTime(domain, period),
        },
      };

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(metrics),
        this.METRICS_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Queue metrics retrieved successfully",
        "AppointmentQueueService",
        { locationId, domain, period, responseTime: Date.now() - startTime },
      );

      return metrics;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue metrics: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          locationId,
          domain,
          period,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  async handleEmergencyAppointment(
    appointmentId: string,
    priority: number,
    domain: string,
  ): Promise<any> {
    const startTime = Date.now();

    try {
      // Find the appointment in queue and move it to the front
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex((entry) => {
          const entryData = JSON.parse(entry);
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          const entryData = JSON.parse(entries[entryIndex]);
          entryData.priority = priority;
          entryData.status = "EMERGENCY";
          entryData.emergencyAt = new Date().toISOString();

          // Remove from current position and add to front of queue
          const updatedEntries = entries.filter(
            (_, index) => index !== entryIndex,
          );
          await this.cacheService.del(key);
          await this.cacheService.rPush(key, JSON.stringify(entryData));
          for (const entry of updatedEntries) {
            await this.cacheService.rPush(key, entry);
          }

          this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            "Emergency appointment handled",
            "AppointmentQueueService",
            {
              appointmentId,
              priority,
              domain,
              responseTime: Date.now() - startTime,
            },
          );

          return {
            success: true,
            message: "Emergency appointment prioritized",
          };
        }
      }

      throw new Error("Appointment not found in queue");
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to handle emergency appointment: ${error instanceof Error ? error.message : String(error)}`,
        "AppointmentQueueService",
        {
          appointmentId,
          priority,
          domain,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  // Helper methods
  private calculateEstimatedWaitTime(position: number, domain: string): number {
    const baseWaitTime = domain === "healthcare" ? 15 : 10; // minutes
    return position * baseWaitTime;
  }

  private calculateAverageWaitTime(queue: any[]): number {
    if (queue.length === 0) return 0;
    const totalWaitTime = queue.reduce(
      (sum, entry) => sum + (entry.estimatedWaitTime || 0),
      0,
    );
    return totalWaitTime / queue.length;
  }

  private calculateActualWaitTime(checkedInAt: string): number {
    if (!checkedInAt) return 0;
    const checkedInTime = new Date(checkedInAt).getTime();
    const currentTime = Date.now();
    return Math.floor((currentTime - checkedInTime) / (1000 * 60)); // minutes
  }

  private calculateThroughput(domain: string, period: string): number {
    // Placeholder implementation - would integrate with actual analytics
    return domain === "healthcare" ? 25 : 15; // appointments per hour
  }

  private calculateAverageResponseTime(domain: string, period: string): number {
    // Placeholder implementation - would integrate with actual analytics
    return domain === "healthcare" ? 12 : 8; // minutes
  }
}
