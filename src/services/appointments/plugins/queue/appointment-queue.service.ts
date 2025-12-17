import { Injectable, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { IEventService } from '@core/types';
import { isEventService } from '@core/types';

import type { AppointmentQueueStats } from '@core/types';
import type {
  QueueEntry,
  QueueEntryData,
  DoctorQueueResponse,
  PatientQueuePositionResponse,
  OperationResponse,
  LocationQueueStatsResponse,
  QueueMetricsResponse,
} from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { QueueEntry, QueueEntryData, AppointmentQueueStats as QueueStats };

@Injectable()
export class AppointmentQueueService {
  private readonly QUEUE_CACHE_TTL = 3600; // 1 hour
  private readonly METRICS_CACHE_TTL = 300; // 5 minutes
  private typedEventService?: IEventService;

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => EventService))
    private readonly eventService?: unknown
  ) {
    // Type guard ensures type safety when using the service
    if (this.eventService && isEventService(this.eventService)) {
      this.typedEventService = this.eventService;
    }
  }

  async getDoctorQueue(
    doctorId: string,
    date: string,
    domain: string,
    locationId?: string
  ): Promise<DoctorQueueResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:doctor:${doctorId}:${date}:${domain}${locationId ? `:${locationId}` : ''}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<DoctorQueueResponse>(cacheKey);
      if (cached) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Doctor queue retrieved from cache',
          'AppointmentQueueService',
          { doctorId, date, domain, locationId, responseTime: Date.now() - startTime }
        );
        return cached;
      }

      // Get queue from Redis
      const queueKey = `queue:${domain}:${doctorId}:${date}`;
      const queueEntries = await this.cacheService.lRange(queueKey, 0, -1);

      // Filter by locationId if provided
      let filteredEntries = queueEntries;
      if (locationId) {
        filteredEntries = queueEntries.filter(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.locationId === locationId;
        });
      }

      const queue: QueueEntryData[] = filteredEntries.map((entry, index) => {
        const entryData = JSON.parse(entry) as QueueEntryData;
        return {
          ...entryData,
          position: index + 1,
          estimatedWaitTime: this.calculateEstimatedWaitTime(index + 1, domain),
        };
      });

      const result: DoctorQueueResponse = {
        doctorId,
        date,
        domain,
        queue,
        totalLength: queue.length,
        averageWaitTime: this.calculateAverageWaitTime(queue),
        estimatedNextWaitTime: queue.length > 0 ? this.calculateEstimatedWaitTime(1, domain) : 0,
      };

      // Cache the result (CacheService handles serialization internally)
      await this.cacheService.set(cacheKey, result as unknown as string, this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor queue retrieved successfully',
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          locationId: locationId || 'all',
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getPatientQueuePosition(
    appointmentId: string,
    domain: string
  ): Promise<PatientQueuePositionResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:position:${appointmentId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<PatientQueuePositionResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Find appointment in all doctor queues
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      let position = -1;
      let doctorId = '';
      let queueKey = '';

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          position = entryIndex + 1;
          doctorId = key.split(':')[2] || '';
          queueKey = key;
          break;
        }
      }

      if (position === -1) {
        throw new NotFoundException(`Appointment ${appointmentId} not found in any queue`);
      }

      const estimatedWaitTime = this.calculateEstimatedWaitTime(position, domain);
      const totalInQueue = await this.cacheService.lLen(queueKey);

      const result: PatientQueuePositionResponse = {
        appointmentId,
        position,
        totalInQueue,
        estimatedWaitTime,
        domain,
        doctorId,
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(cacheKey, result as unknown as string, 60);

      // Emit WebSocket event for queue position update
      if (this.typedEventService) {
        try {
          await this.typedEventService.emitEnterprise('appointment.queue.position.updated', {
            eventId: `queue-position-${appointmentId}-${Date.now()}`,
            eventType: 'appointment.queue.position.updated',
            category: EventCategory.APPOINTMENT,
            priority: EventPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: 'AppointmentQueueService',
            version: '1.0.0',
            appointmentId,
            payload: {
              appointmentId,
              position,
              totalInQueue,
              estimatedWaitTime,
              doctorId,
              domain,
            },
          });
        } catch (eventError) {
          // Don't fail queue position retrieval if event emission fails
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to emit queue position event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
            'AppointmentQueueService'
          );
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved successfully',
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          position,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async confirmAppointment(appointmentId: string, domain: string): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find and update appointment in queue
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          const entryData = JSON.parse(entries[entryIndex] || '{}') as QueueEntryData;
          entryData.status = 'CONFIRMED';
          entryData.confirmedAt = new Date().toISOString();

          // Update the entry in the queue (CacheService handles serialization)
          await this.cacheService.set(
            `${key}:${entryIndex}`,
            entryData as unknown as string,
            this.QUEUE_CACHE_TTL
          );

          void this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Appointment confirmed in queue',
            'AppointmentQueueService',
            { appointmentId, domain, responseTime: Date.now() - startTime }
          );

          return { success: true, message: 'Appointment confirmed' };
        }
      }

      throw new Error('Appointment not found in queue');
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startConsultation(
    appointmentId: string,
    doctorId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      const queueKey = `queue:${domain}:${doctorId}:${new Date().toISOString().split('T')[0]}`;
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      const entryIndex = entries.findIndex(entry => {
        const entryData = JSON.parse(entry) as QueueEntryData;
        return entryData.appointmentId === appointmentId;
      });

      if (entryIndex === -1) {
        throw new NotFoundException(`Appointment ${appointmentId} not found in queue`);
      }

      const entryData = JSON.parse(entries[entryIndex] || '{}') as QueueEntryData;
      entryData.status = 'IN_PROGRESS';
      entryData.startedAt = new Date().toISOString();
      entryData.actualWaitTime = this.calculateActualWaitTime(entryData.checkedInAt || '');

      // Update the entry in the queue (CacheService handles serialization)
      await this.cacheService.set(
        `${queueKey}:${entryIndex}`,
        entryData as unknown as string,
        this.QUEUE_CACHE_TTL
      );

      // Invalidate cache
      await this.cacheService.del(
        `queue:doctor:${doctorId}:${new Date().toISOString().split('T')[0]}:${domain}`
      );

      // Emit WebSocket event for queue update (consultation started)
      if (this.typedEventService) {
        try {
          // Recalculate queue positions after consultation started
          const updatedEntries = await this.cacheService.lRange(queueKey, 0, -1);
          const updatedPositions = updatedEntries.map((entry, index) => {
            const entryData = JSON.parse(entry) as QueueEntryData;
            return {
              appointmentId: entryData.appointmentId,
              position: index + 1,
            };
          });

          await this.typedEventService.emitEnterprise('appointment.queue.updated', {
            eventId: `queue-updated-${doctorId}-${Date.now()}`,
            eventType: 'appointment.queue.updated',
            category: EventCategory.APPOINTMENT,
            priority: EventPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: 'AppointmentQueueService',
            version: '1.0.0',
            payload: {
              doctorId,
              domain,
              consultationStarted: appointmentId,
              queuePositions: updatedPositions,
            },
          });
        } catch (eventError) {
          // Don't fail if event emission fails
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to emit queue update event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
            'AppointmentQueueService'
          );
        }
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Consultation started',
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          domain,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Consultation started' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async reorderQueue(
    reorderData: {
      doctorId: string;
      date: string;
      newOrder: string[];
    },
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      const { doctorId, date, newOrder } = reorderData;
      const queueKey = `queue:${domain}:${doctorId}:${date}`;

      // Get current queue
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      // Reorder based on new order
      const reorderedEntries = newOrder
        .map((appointmentId: string) => {
          return entries.find(entry => {
            const entryData = JSON.parse(entry) as QueueEntryData;
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

      // Emit WebSocket event for queue reorder
      if (this.typedEventService) {
        try {
          const updatedPositions = reorderedEntries.map((entry, index) => {
            const entryData = JSON.parse(entry as string) as QueueEntryData;
            return {
              appointmentId: entryData.appointmentId,
              position: index + 1,
            };
          });

          await this.typedEventService.emitEnterprise('appointment.queue.reordered', {
            eventId: `queue-reordered-${doctorId}-${Date.now()}`,
            eventType: 'appointment.queue.reordered',
            category: EventCategory.APPOINTMENT,
            priority: EventPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: 'AppointmentQueueService',
            version: '1.0.0',
            payload: {
              doctorId,
              date,
              domain,
              queuePositions: updatedPositions,
            },
          });
        } catch (eventError) {
          // Don't fail if event emission fails
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to emit queue reorder event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
            'AppointmentQueueService'
          );
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue reordered successfully',
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          newOrderLength: newOrder.length,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Queue reordered successfully' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          reorderData,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationQueueStats(
    locationId: string,
    domain: string
  ): Promise<LocationQueueStatsResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:stats:location:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<LocationQueueStatsResponse>(cacheKey);
      if (cached) {
        return cached;
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
          const entryData = JSON.parse(entry) as QueueEntryData;
          if (entryData.locationId === locationId) {
            if (entryData.status === 'WAITING') {
              totalWaiting++;
              totalWaitTime += entryData.estimatedWaitTime || 0;
            } else if (entryData.status === 'COMPLETED') {
              completedCount++;
            }
          }
        }
      }

      const averageWaitTime = totalWaiting > 0 ? totalWaitTime / totalWaiting : 0;
      const efficiency =
        completedCount > 0 ? (completedCount / (completedCount + totalWaiting)) * 100 : 0;
      const utilization = totalWaiting > 0 ? Math.min((totalWaiting / 50) * 100, 100) : 0; // Assuming max capacity of 50

      const result: LocationQueueStatsResponse = {
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

      // Cache the result (CacheService handles serialization internally)
      await this.cacheService.set(cacheKey, result as unknown as string, this.METRICS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location queue stats retrieved successfully',
        'AppointmentQueueService',
        {
          locationId,
          domain,
          totalWaiting,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue stats: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getQueueMetrics(
    locationId: string,
    domain: string,
    period: string
  ): Promise<QueueMetricsResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:metrics:${locationId}:${domain}:${period}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<QueueMetricsResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Calculate metrics based on period
      const statsResult = await this.getLocationQueueStats(locationId, domain);

      // Add period-specific calculations
      const metrics: QueueMetricsResponse = {
        ...statsResult,
        period,
        metrics: {
          efficiency: statsResult.stats.efficiency || 0,
          utilization: statsResult.stats.utilization || 0,
          throughput: this.calculateThroughput(domain, period),
          responseTime: this.calculateAverageResponseTime(domain, period),
        },
      };

      // Cache the result (CacheService handles serialization internally)
      await this.cacheService.set(cacheKey, metrics as unknown as string, this.METRICS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue metrics retrieved successfully',
        'AppointmentQueueService',
        { locationId, domain, period, responseTime: Date.now() - startTime }
      );

      return metrics;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue metrics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          locationId,
          domain,
          period,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async handleEmergencyAppointment(
    appointmentId: string,
    priority: number,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find the appointment in queue and move it to the front
      const pattern = `queue:${domain}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          const entryData = JSON.parse(entries[entryIndex] || '{}') as QueueEntryData;
          entryData.priority = priority;
          entryData.status = 'EMERGENCY';
          entryData.emergencyAt = new Date().toISOString();

          // Remove from current position and add to front of queue
          const updatedEntries = entries.filter((_, index) => index !== entryIndex);
          await this.cacheService.del(key);
          await this.cacheService.rPush(key, JSON.stringify(entryData));
          for (const entry of updatedEntries) {
            await this.cacheService.rPush(key, entry);
          }

          void this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Emergency appointment handled',
            'AppointmentQueueService',
            {
              appointmentId,
              priority,
              domain,
              responseTime: Date.now() - startTime,
            }
          );

          return {
            success: true,
            message: 'Emergency appointment prioritized',
          };
        }
      }

      throw new NotFoundException(`Appointment ${appointmentId} not found in queue`);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to handle emergency appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          priority,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // Helper methods
  private calculateEstimatedWaitTime(position: number, domain: string): number {
    const baseWaitTime = domain === 'healthcare' ? 15 : 10; // minutes
    return position * baseWaitTime;
  }

  private calculateAverageWaitTime(queue: QueueEntryData[]): number {
    if (queue.length === 0) return 0;
    const totalWaitTime = queue.reduce(
      (sum: number, entry: QueueEntryData) => sum + (entry.estimatedWaitTime || 0),
      0
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
    // Use period to determine throughput calculation
    const baseThroughput = domain === 'healthcare' ? 25 : 15;
    const periodMultiplier = period === 'daily' ? 1 : period === 'weekly' ? 7 : 1;
    return baseThroughput * periodMultiplier; // appointments per hour
  }

  private calculateAverageResponseTime(domain: string, period: string): number {
    // Placeholder implementation - would integrate with actual analytics
    // Use period to determine response time calculation
    const baseResponseTime = domain === 'healthcare' ? 12 : 8;
    const periodAdjustment = period === 'daily' ? 1 : period === 'weekly' ? 0.8 : 1;
    return Math.round(baseResponseTime * periodAdjustment); // minutes
  }
}
