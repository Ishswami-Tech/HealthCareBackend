import { Injectable, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { IEventService } from '@core/types';
import { isEventService } from '@core/types';
import { LaneType } from '@core/types/enums.types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

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
import { formatDateKeyInIST, nowIso } from '../../../../utils/date-time.util';

// Re-export types for backward compatibility
export type { QueueEntry, QueueEntryData, AppointmentQueueStats as QueueStats };

const PRIORITY_WEIGHTS: Record<string, number> = {
  EMERGENCY: 100,
  URGENT: 80,
  HIGH: 50,
  MEDIUM: 30,
  NORMAL: 20,
  LOW: 10,
  ROUTINE: 0,
};

@Injectable()
export class AppointmentQueueService {
  private readonly QUEUE_CACHE_TTL = 3600; // 1 hour
  private readonly METRICS_CACHE_TTL = 300; // 5 minutes
  private typedEventService?: IEventService;

  constructor(
    @Inject('CACHE_SERVICE')
    private readonly cacheService: CacheService,
    @Inject('LOGGING_SERVICE')
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

  private getQueueDate(date?: string): string {
    return date || formatDateKeyInIST(new Date()) || '';
  }

  private buildQueueKey(domain: string, clinicId: string, ownerId: string, date?: string): string {
    return `queue:${domain}:${clinicId}:${ownerId}:${this.getQueueDate(date)}`;
  }

  private normalizeQueueLabel(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
  }

  private resolveDisplayLabel(queueCategory: string, treatmentType?: string): string {
    const normalizedTreatment = this.normalizeQueueLabel(treatmentType);
    const normalizedCategory = this.normalizeQueueLabel(queueCategory);

    if (normalizedTreatment === 'general_consultation') return 'General Consultation';
    if (normalizedTreatment === 'follow_up') return 'Follow Up';
    if (normalizedTreatment === 'special_case') return 'Special Case';
    if (normalizedTreatment === 'geriatric_care' || normalizedTreatment === 'senior_citizen')
      return 'Senior Citizen';
    if (
      normalizedTreatment === 'lab_test' ||
      normalizedTreatment === 'imaging' ||
      normalizedTreatment === 'vaccination'
    )
      return 'Diagnostic';
    if (
      normalizedTreatment === 'dosha_analysis' ||
      normalizedTreatment === 'virechana' ||
      normalizedTreatment === 'abhyanga' ||
      normalizedTreatment === 'swedana' ||
      normalizedTreatment === 'basti' ||
      normalizedTreatment === 'nasya' ||
      normalizedTreatment === 'raktamokshana'
    ) {
      return 'Ayurvedic Procedures';
    }
    if (
      normalizedTreatment === 'therapy' ||
      normalizedTreatment === 'surgery' ||
      normalizedTreatment === 'therapy_procedure' ||
      normalizedCategory === 'therapy_procedure'
    ) {
      return 'Procedural Care';
    }
    if (normalizedCategory === 'doctor_consultation') return 'Consultation';
    if (normalizedCategory === 'medicine_desk') return 'Medicine Desk';
    if (normalizedCategory === 'therapy_procedure') return 'Procedural Care';
    return String(queueCategory || treatmentType || 'General Consultation')
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
      .join(' ');
  }

  private async deleteCacheKeys(patterns: string[]): Promise<void> {
    const keysToDelete = new Set<string>();

    for (const pattern of patterns) {
      const keys = await this.cacheService.keys(pattern);
      for (const key of keys) {
        keysToDelete.add(key);
      }
    }

    for (const key of keysToDelete) {
      await this.cacheService.del(key);
    }
  }

  private async emitAppointmentQueueEvent(
    eventType: 'appointment.queue.updated' | 'appointment.queue.position.updated',
    params: {
      eventId: string;
      priority?: EventPriority;
      appointmentId?: string;
      payload: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.typedEventService) {
      return;
    }

    await this.typedEventService.emitEnterprise(eventType, {
      eventId: params.eventId,
      eventType,
      category: EventCategory.APPOINTMENT,
      priority: params.priority ?? EventPriority.NORMAL,
      timestamp: nowIso(),
      source: 'AppointmentQueueService',
      version: '1.0.0',
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      payload: params.payload,
    } as EnterpriseEventPayload);
  }

  private async rewriteQueueList(queueKey: string, entries: string[]): Promise<void> {
    await this.cacheService.del(queueKey);
    for (const entry of entries) {
      await this.cacheService.rPush(queueKey, entry);
    }
  }

  private async invalidateQueueReadCaches(params: {
    clinicId: string;
    domain: string;
    doctorId?: string | undefined;
    date?: string | undefined;
    locationId?: string | undefined;
    appointmentId?: string | undefined;
  }): Promise<void> {
    const patterns: string[] = [];
    const normalizedDate = this.getQueueDate(params.date);

    if (params.doctorId) {
      patterns.push(
        `queue:doctor:${params.clinicId}:${params.doctorId}:${normalizedDate}:${params.domain}`
      );
      if (params.locationId) {
        patterns.push(
          `queue:doctor:${params.clinicId}:${params.doctorId}:${normalizedDate}:${params.domain}:${params.locationId}`
        );
      }
      patterns.push(
        `queue:status:${params.domain}:${params.clinicId}:${params.doctorId}:${normalizedDate}`
      );
    }

    if (params.appointmentId) {
      patterns.push(`queue:position:${params.clinicId}:${params.appointmentId}:${params.domain}`);
      patterns.push(`queue:position:${params.appointmentId}:${params.clinicId}`);
      patterns.push(`queue:position:${params.clinicId}:${params.appointmentId}:*`);
    }

    if (params.locationId) {
      patterns.push(
        `queue:stats:location:${params.clinicId}:${params.locationId}:${params.domain}`
      );
      patterns.push(`queue:metrics:${params.clinicId}:${params.locationId}:${params.domain}:*`);
    }

    await this.deleteCacheKeys(patterns);
  }

  async enqueueOperationalItem(
    queueData: {
      entryId: string;
      queueOwnerId: string;
      patientId: string;
      clinicId: string;
      appointmentId?: string | undefined;
      assignedDoctorId?: string | undefined;
      primaryDoctorId?: string | undefined;
      locationId?: string | undefined;
      queueCategory: string;
      displayLabel?: string | undefined;
      laneType?: string | undefined;
      type?: string | undefined;
      notes?: string | undefined;
      estimatedWaitTime?: number | undefined;
    },
    domain: string
  ): Promise<OperationResponse> {
    const queueKey = this.buildQueueKey(domain, queueData.clinicId, queueData.queueOwnerId);

    try {
      const existingEntries = await this.cacheService.lRange(queueKey, 0, -1);
      const exists = existingEntries.some(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.entryId === queueData.entryId;
      });

      if (exists) {
        return { success: true, message: 'Queue item already exists' };
      }

      if (queueData.laneType && !Object.values(LaneType).includes(queueData.laneType as LaneType)) {
        throw new Error(`Invalid laneType: ${queueData.laneType}`);
      }

      const queueEntry: QueueEntryData = {
        entryId: queueData.entryId,
        appointmentId: queueData.appointmentId || queueData.entryId,
        patientId: queueData.patientId,
        doctorId: queueData.assignedDoctorId || queueData.queueOwnerId,
        clinicId: queueData.clinicId,
        status: 'WAITING',
        checkedInAt: nowIso(),
        priority:
          queueData.laneType === 'VIP'
            ? 100
            : typeof queueData.notes === 'string' && queueData.notes.includes('URGENT')
              ? 80
              : 0,
        ...(queueData.estimatedWaitTime !== undefined && {
          estimatedWaitTime: queueData.estimatedWaitTime,
        }),
        ...(queueData.type && { type: queueData.type }),
        ...(queueData.notes && { notes: queueData.notes }),
        ...(queueData.locationId && { locationId: queueData.locationId }),
        queueCategory: queueData.queueCategory,
        displayLabel:
          queueData.displayLabel ||
          this.resolveDisplayLabel(queueData.queueCategory, queueData.type),
        ...(queueData.laneType && { laneType: queueData.laneType }),
        queueOwnerId: queueData.queueOwnerId,
        ...(queueData.primaryDoctorId && { primaryDoctorId: queueData.primaryDoctorId }),
        ...(queueData.assignedDoctorId && { assignedDoctorId: queueData.assignedDoctorId }),
      };

      await this.cacheService.rPush(queueKey, JSON.stringify(queueEntry));
      await this.invalidateQueueReadCaches({
        clinicId: queueData.clinicId,
        domain,
        doctorId: queueData.assignedDoctorId || queueData.queueOwnerId,
        appointmentId: queueEntry.appointmentId,
        locationId: queueData.locationId,
      });

      const totalInQueue = await this.cacheService.lLen(queueKey);
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-enqueue-${queueData.entryId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId: queueData.queueOwnerId,
          domain,
          action: 'CHECK_IN',
          appointmentId: queueEntry.appointmentId,
          entryId: queueData.entryId,
          queueCategory: queueData.queueCategory,
          displayLabel:
            queueData.displayLabel ||
            this.resolveDisplayLabel(queueData.queueCategory, queueData.type),
          position: totalInQueue,
          totalInQueue,
          clinicId: queueData.clinicId,
          queueOwnerId: queueData.queueOwnerId,
          locationId: queueData.locationId,
          primaryDoctorId: queueData.primaryDoctorId,
          assignedDoctorId: queueData.assignedDoctorId,
        },
      });

      return { success: true, message: 'Queue item added successfully' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to enqueue operational item: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        {
          entryId: queueData.entryId,
          queueOwnerId: queueData.queueOwnerId,
        }
      );
      throw error;
    }
  }

  async getOperationalQueue(
    queueOwnerId: string,
    clinicId: string,
    domain: string,
    date?: string
  ): Promise<QueueEntryData[]> {
    const queueKey = this.buildQueueKey(domain, clinicId, queueOwnerId, date);
    const entries = await this.cacheService.lRange(queueKey, 0, -1);
    const parsedEntries = entries.map(entry => JSON.parse(entry) as QueueEntryData);

    // Sort by priority (desc) then by check-in time (asc)
    const sortedEntries = parsedEntries.sort((a, b) => {
      const pA = a.priority ?? 0;
      const pB = b.priority ?? 0;
      if (pA !== pB) return pB - pA;
      return new Date(a.checkedInAt || 0).getTime() - new Date(b.checkedInAt || 0).getTime();
    });

    return sortedEntries.map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
  }

  async getClinicQueue(clinicId: string, date: string, domain: string): Promise<QueueEntryData[]> {
    const normalizedDate = this.getQueueDate(date);
    const queuePattern = `queue:${domain}:${clinicId}:*:${normalizedDate}`;
    const queueKeys = await this.cacheService.keys(queuePattern);
    const clinicEntries: QueueEntryData[] = [];

    for (const queueKey of queueKeys) {
      const ownerId = this.extractOwnerIdFromQueueKey(queueKey);
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      entries.forEach((entry, index) => {
        try {
          const parsed = JSON.parse(entry) as QueueEntryData;
          clinicEntries.push({
            ...parsed,
            queueOwnerId: parsed.queueOwnerId || ownerId,
            doctorId: parsed.doctorId || ownerId,
            position: parsed.position || index + 1,
          });
        } catch {
          // Ignore malformed entries and continue building the clinic queue snapshot.
        }
      });
    }

    clinicEntries.sort((left, right) => {
      const leftPriority = left.priority || 0;
      const rightPriority = right.priority || 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;

      const leftCheckedIn = new Date(left.checkedInAt || 0).getTime();
      const rightCheckedIn = new Date(right.checkedInAt || 0).getTime();
      return leftCheckedIn - rightCheckedIn;
    });

    return clinicEntries.map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
  }

  async removeOperationalQueueItem(
    entryId: string,
    queueOwnerId: string,
    clinicId: string,
    domain: string,
    date?: string
  ): Promise<OperationResponse> {
    const queueKey = this.buildQueueKey(domain, clinicId, queueOwnerId, date);
    const entries = await this.cacheService.lRange(queueKey, 0, -1);
    const remainingEntries = entries.filter(entry => {
      const data = JSON.parse(entry) as QueueEntryData;
      return data.entryId !== entryId;
    });

    if (entries.length === remainingEntries.length) {
      return { success: false, message: 'Queue item not found' };
    }

    await this.cacheService.del(queueKey);
    for (const entry of remainingEntries) {
      await this.cacheService.rPush(queueKey, entry);
    }

    const queueCategory =
      remainingEntries.length > 0
        ? (() => {
            const parsed = JSON.parse(remainingEntries[0] || '{}') as QueueEntryData;
            return typeof parsed.queueCategory === 'string' ? parsed.queueCategory : undefined;
          })()
        : undefined;
    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-remove-${entryId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId: queueOwnerId,
        domain,
        action: 'REMOVED',
        entryId,
        clinicId,
        queueOwnerId,
        ...(queueCategory ? { queueCategory } : {}),
      },
    });

    return { success: true, message: 'Queue item removed successfully' };
  }

  async transferOperationalQueueItem(
    entryId: string,
    clinicId: string,
    domain: string,
    targetQueue: string,
    treatmentType?: string,
    notes?: string
  ): Promise<OperationResponse & { data?: Record<string, unknown> }> {
    const normalizedTargetQueue = String(targetQueue || '')
      .trim()
      .toUpperCase();
    const nextQueueCategory = this.mapTargetQueueToCategory(normalizedTargetQueue);
    const nextType = this.resolveQueueEntryType(nextQueueCategory, treatmentType);
    const today = this.getQueueDate();

    const searchPatterns = [
      `queue:${domain}:${clinicId}:*:${today}`,
      `queue:${domain}:${clinicId}:*:*`,
    ];

    const visitedKeys = new Set<string>();
    const queueKeys: string[] = [];
    for (const pattern of searchPatterns) {
      const keys = await this.cacheService.keys(pattern);
      keys.forEach(key => {
        if (!visitedKeys.has(key)) {
          visitedKeys.add(key);
          queueKeys.push(key);
        }
      });
    }

    for (const queueKey of queueKeys) {
      const entries = await this.cacheService.lRange(queueKey, 0, -1);
      const ownerId = this.extractOwnerIdFromQueueKey(queueKey);
      let updated = false;
      let appointmentId = '';
      let previousQueueCategory = '';
      const nextEntries = entries.map(entry => {
        try {
          const parsed = JSON.parse(entry) as QueueEntryData;
          const parsedEntryId = parsed.entryId || parsed.appointmentId;
          if (String(parsedEntryId) !== String(entryId)) {
            return entry;
          }

          appointmentId = String(parsed.appointmentId || parsed.entryId || entryId);
          previousQueueCategory = String(parsed.queueCategory || '');
          const mergedNotes = [parsed.notes, notes].filter(Boolean).join(' | ');

          const nextEntry: QueueEntryData = {
            ...parsed,
            queueCategory: nextQueueCategory,
            displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
            ...(nextType ? { type: nextType } : {}),
            ...(mergedNotes ? { notes: mergedNotes } : {}),
            queueOwnerId: parsed.queueOwnerId || ownerId || parsed.doctorId,
          };
          updated = true;
          return JSON.stringify(nextEntry);
        } catch {
          return entry;
        }
      });

      if (!updated) continue;

      await this.cacheService.del(queueKey);
      for (const entry of nextEntries) {
        await this.cacheService.rPush(queueKey, entry);
      }

      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId: ownerId,
        date: queueKey.split(':')[4] || this.getQueueDate(),
        locationId: (() => {
          try {
            const parsed = nextEntries.find(entry => {
              const data = JSON.parse(entry) as QueueEntryData;
              return String(data.entryId || data.appointmentId || '') === String(entryId);
            });
            if (!parsed) return undefined;
            return (JSON.parse(parsed) as QueueEntryData).locationId;
          } catch {
            return undefined;
          }
        })(),
        appointmentId,
      });

      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-transfer-${entryId}-${Date.now()}`,
        priority: EventPriority.HIGH,
        payload: {
          action: 'TRANSFERRED',
          entryId,
          appointmentId,
          clinicId,
          domain,
          queueOwnerId: ownerId,
          doctorId: ownerId,
          targetQueue: normalizedTargetQueue,
          treatmentType: nextType || treatmentType,
          queueCategory: nextQueueCategory,
          displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
          previousQueueCategory,
        },
      });

      return {
        success: true,
        message: 'Queue item transferred successfully',
        data: {
          entryId,
          appointmentId,
          queueOwnerId: ownerId,
          previousQueueCategory,
          queueCategory: nextQueueCategory,
          targetQueue: normalizedTargetQueue,
          treatmentType: nextType || treatmentType,
          displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
        },
      };
    }

    return { success: false, message: 'Queue item not found' };
  }

  async checkIn(
    checkInData: {
      appointmentId: string;
      doctorId: string;
      patientId: string;
      clinicId: string;
      appointmentType?: string;
      notes?: string;
      locationId?: string;
      priority?: string | number;
    },
    domain: string
  ): Promise<OperationResponse> {
    const { appointmentId, doctorId, patientId, clinicId, appointmentType, notes, locationId } =
      checkInData;
    const date = formatDateKeyInIST(new Date());
    // P1 FIX: Include clinicId in cache key for strict isolation
    const cacheKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      // Check if already in queue
      const existingEntries = await this.cacheService.lRange(cacheKey, 0, -1);
      const exists = existingEntries.some(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.appointmentId === appointmentId;
      });

      if (exists) {
        throw new Error('Appointment arrival is already confirmed');
      }

      const queueEntry: QueueEntryData = {
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        status: 'WAITING',
        checkedInAt: nowIso(),
        priority:
          typeof checkInData.priority === 'number'
            ? checkInData.priority
            : (PRIORITY_WEIGHTS[String(checkInData.priority).toUpperCase()] ?? 0),
      };

      if (appointmentType) {
        queueEntry.type = appointmentType;
        queueEntry.displayLabel = this.resolveDisplayLabel('DOCTOR_CONSULTATION', appointmentType);
      }
      if (!queueEntry.displayLabel) {
        queueEntry.displayLabel = this.resolveDisplayLabel('DOCTOR_CONSULTATION', appointmentType);
      }
      if (notes) queueEntry.notes = notes;
      if (locationId) queueEntry.locationId = locationId;

      await this.cacheService.rPush(cacheKey, JSON.stringify(queueEntry));
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        appointmentId,
        locationId,
      });

      // Emit WebSocket event
      const totalInQueue = await this.cacheService.lLen(cacheKey);
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-checkin-${appointmentId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId,
          domain,
          action: 'CHECK_IN',
          appointmentId,
          position: totalInQueue,
          totalInQueue,
          clinicId,
          queueOwnerId: doctorId,
          locationId,
          queueCategory: 'DOCTOR_CONSULTATION',
        },
      });

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Patient arrival confirmed successfully',
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          queueLength: exists ? existingEntries.length : existingEntries.length + 1,
        }
      );

      return { success: true, message: 'Checked in successfully' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Check-in failed: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { appointmentId, error: error instanceof Error ? error.stack : undefined }
      );
      throw error;
    }
  }

  async getDoctorQueue(
    doctorId: string,
    clinicId: string,
    date: string,
    domain: string,
    locationId?: string
  ): Promise<DoctorQueueResponse> {
    const startTime = Date.now();
    // P1 FIX: Include clinicId in cache key
    const cacheKey = `queue:doctor:${clinicId}:${doctorId}:${date}:${domain}${locationId ? `:${locationId}` : ''}`;

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

      // Get queue from Redis with clinic isolation
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;
      const queueEntries = await this.cacheService.lRange(queueKey, 0, -1);

      // Filter by locationId if provided
      let filteredEntries = queueEntries;
      if (locationId) {
        filteredEntries = queueEntries.filter(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.locationId === locationId;
        });
      }

      const parsedEntries = filteredEntries.map(entry => JSON.parse(entry) as QueueEntryData);

      // Sort by priority (desc) then by check-in time (asc)
      const sortedEntries = parsedEntries.sort((a, b) => {
        const pA = a.priority ?? 0;
        const pB = b.priority ?? 0;
        if (pA !== pB) return pB - pA;
        return new Date(a.checkedInAt || 0).getTime() - new Date(b.checkedInAt || 0).getTime();
      });

      const queue: QueueEntryData[] = sortedEntries.map((entry, index) => {
        return {
          ...entry,
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
    clinicId: string,
    domain: string
  ): Promise<PatientQueuePositionResponse> {
    const cacheKey = `queue:position:${clinicId}:${appointmentId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<PatientQueuePositionResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Find appointment in all doctor queues for this clinic
      const pattern = `queue:${domain}:${clinicId}:*`;
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
          // Key format: queue:{domain}:{clinicId}:{doctorId}:{date}
          doctorId = key.split(':')[3] || '';
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
      try {
        await this.emitAppointmentQueueEvent('appointment.queue.position.updated', {
          eventId: `queue-position-${appointmentId}-${Date.now()}`,
          priority: EventPriority.NORMAL,
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

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved successfully',
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          position,
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

  async confirmAppointment(
    appointmentId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find and update appointment in queue
      // Strict isolation: only look in this clinic's queues
      const pattern = `queue:${domain}:${clinicId}:*`;
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
          entryData.confirmedAt = nowIso();
          const updatedEntries = [...entries];
          updatedEntries[entryIndex] = JSON.stringify(entryData);
          await this.rewriteQueueList(key, updatedEntries);

          const keyParts = key.split(':');
          const queueDate = keyParts[4] || this.getQueueDate();
          await this.invalidateQueueReadCaches({
            clinicId,
            domain,
            doctorId: entryData.doctorId || entryData.queueOwnerId || undefined,
            date: queueDate,
            locationId: entryData.locationId,
            appointmentId,
          });

          await this.emitAppointmentQueueEvent('appointment.queue.updated', {
            eventId: `queue-confirm-${appointmentId}-${Date.now()}`,
            priority: EventPriority.NORMAL,
            payload: {
              doctorId: entryData.doctorId || entryData.queueOwnerId,
              domain,
              action: 'CONFIRMED',
              appointmentId,
              clinicId,
              queueOwnerId: entryData.queueOwnerId || entryData.doctorId,
              queueCategory: entryData.queueCategory || 'DOCTOR_CONSULTATION',
              displayLabel: entryData.displayLabel,
              locationId: entryData.locationId,
            },
          });

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
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // P1 FIX: Include clinicId in key
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${formatDateKeyInIST(new Date())}`;
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
      entryData.startedAt = nowIso();
      entryData.actualWaitTime = this.calculateActualWaitTime(entryData.checkedInAt || '');
      const updatedEntries = [...entries];
      updatedEntries[entryIndex] = JSON.stringify(entryData);
      await this.rewriteQueueList(queueKey, updatedEntries);

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date: formatDateKeyInIST(new Date()),
        locationId: entryData.locationId,
        appointmentId,
      });

      // Emit WebSocket event for queue update (consultation started)
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

        await this.emitAppointmentQueueEvent('appointment.queue.updated', {
          eventId: `queue-updated-${doctorId}-${Date.now()}`,
          priority: EventPriority.NORMAL,
          payload: {
            doctorId,
            domain,
            action: 'STARTED',
            appointmentId,
            clinicId,
            queueOwnerId: doctorId,
            queueCategory: 'DOCTOR_CONSULTATION',
            displayLabel:
              entryData.displayLabel ||
              this.resolveDisplayLabel('DOCTOR_CONSULTATION', entryData.type),
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
      clinicId: string;
      date: string;
      newOrder: string[];
    },
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      const { doctorId, clinicId, date, newOrder } = reorderData;
      // P1 FIX: Include clinicId
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

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
      await this.rewriteQueueList(
        queueKey,
        reorderedEntries.map(entry => entry as string)
      );

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
      });

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
            timestamp: nowIso(),
            source: 'AppointmentQueueService',
            version: '1.0.0',
            payload: {
              doctorId,
              date,
              domain,
              action: 'REORDERED',
              clinicId,
              queueOwnerId: doctorId,
              queueCategory: 'DOCTOR_CONSULTATION',
              queuePositions: updatedPositions,
            },
          });
          await this.emitAppointmentQueueEvent('appointment.queue.updated', {
            eventId: `queue-reordered-alias-${doctorId}-${Date.now()}`,
            priority: EventPriority.NORMAL,
            payload: {
              doctorId,
              date,
              domain,
              action: 'REORDERED',
              clinicId,
              queueOwnerId: doctorId,
              queueCategory: 'DOCTOR_CONSULTATION',
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
    clinicId: string,
    domain: string
  ): Promise<LocationQueueStatsResponse> {
    const startTime = Date.now();
    // P1 FIX: Include clinicId in metrics cache
    const cacheKey = `queue:stats:location:${clinicId}:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<LocationQueueStatsResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get all queues for the location (scoped by clinic)
      const pattern = `queue:${domain}:${clinicId}:*`;
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
    clinicId: string,
    domain: string,
    period: string
  ): Promise<QueueMetricsResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:metrics:${clinicId}:${locationId}:${domain}:${period}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<QueueMetricsResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Calculate metrics based on period
      const statsResult = await this.getLocationQueueStats(locationId, clinicId, domain);

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
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find the appointment in queue (scoped by clinic)
      const pattern = `queue:${domain}:${clinicId}:*`;
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
          entryData.emergencyAt = nowIso();

          // Remove from current position and add to front of queue
          const updatedEntries = entries.filter((_, index) => index !== entryIndex);
          await this.cacheService.del(key);
          await this.cacheService.rPush(key, JSON.stringify(entryData));
          for (const entry of updatedEntries) {
            await this.cacheService.rPush(key, entry);
          }

          await this.invalidateQueueReadCaches({
            clinicId,
            domain,
            doctorId: entryData.doctorId || entryData.queueOwnerId,
            date: key.split(':')[4] || this.getQueueDate(),
            locationId: entryData.locationId,
            appointmentId,
          });

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

  async removePatientFromQueue(
    appointmentId: string,
    doctorId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      const entries = await this.cacheService.lRange(queueKey, 0, -1);
      const newEntries = entries.filter(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.appointmentId !== appointmentId;
      });

      if (entries.length === newEntries.length) {
        return { success: false, message: 'Patient not found in queue' };
      }

      await this.rewriteQueueList(queueKey, newEntries);
      const removedEntry = entries
        .map(entry => JSON.parse(entry) as QueueEntryData)
        .find(entry => entry.appointmentId === appointmentId);
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        locationId: removedEntry?.locationId,
        appointmentId,
      });

      // Emit Event
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-remove-${appointmentId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId,
          domain,
          action: 'REMOVED',
          appointmentId,
          clinicId,
          queueOwnerId: doctorId,
          queueCategory: 'DOCTOR_CONSULTATION',
          displayLabel: removedEntry?.displayLabel,
        },
      });

      return { success: true, message: 'Patient removed from queue' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to remove patient from queue: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { error: error instanceof Error ? error.stack : undefined }
      );
      throw error;
    }
  }

  async callNext(
    doctorId: string,
    clinicId: string,
    domain: string,
    appointmentId: string
  ): Promise<OperationResponse & { nextPatient?: QueueEntryData }> {
    const date = formatDateKeyInIST(new Date());
    // P1 FIX: Include clinicId
    const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      // Find the specific patient being called
      const nextIndex = entries.findIndex(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.appointmentId === appointmentId;
      });

      if (nextIndex === -1) {
        return { success: false, message: 'Patient not found in queue' };
      }

      const entryData = JSON.parse(entries[nextIndex] || '{}') as QueueEntryData;
      entryData.status = 'IN_PROGRESS';
      entryData.startedAt = nowIso();

      // Update local array
      entries[nextIndex] = JSON.stringify(entryData);

      // Replace list in Redis
      await this.rewriteQueueList(queueKey, entries);

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        locationId: entryData.locationId,
        appointmentId,
      });

      // Emit Event
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-callnext-${doctorId}-${Date.now()}`,
        priority: EventPriority.HIGH,
        payload: {
          doctorId,
          domain,
          action: 'CALL_NEXT',
          appointmentId: entryData.appointmentId,
          entryId: entryData.entryId,
          nextPatient: entryData,
          clinicId,
          queueOwnerId: doctorId,
          queueCategory: 'DOCTOR_CONSULTATION',
          displayLabel: entryData.displayLabel,
        },
      });

      return { success: true, message: 'Next patient called', nextPatient: entryData };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to call next patient: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { error: error instanceof Error ? error.stack : undefined }
      );
      throw error;
    }
  }

  async pauseQueue(doctorId: string, clinicId: string, domain: string): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    await this.cacheService.set(
      `queue:status:${domain}:${clinicId}:${doctorId}:${date}`,
      'PAUSED',
      3600
    );
    await this.invalidateQueueReadCaches({
      clinicId,
      domain,
      doctorId,
      date,
    });

    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-pause-${doctorId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId,
        domain,
        action: 'PAUSED',
        clinicId,
        queueOwnerId: doctorId,
        queueCategory: 'DOCTOR_CONSULTATION',
      },
    });
    return { success: true, message: 'Queue paused' };
  }

  async resumeQueue(
    doctorId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    await this.cacheService.del(`queue:status:${domain}:${clinicId}:${doctorId}:${date}`);
    await this.invalidateQueueReadCaches({
      clinicId,
      domain,
      doctorId,
      date,
    });

    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-resume-${doctorId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId,
        domain,
        action: 'RESUMED',
        clinicId,
        queueOwnerId: doctorId,
        queueCategory: 'DOCTOR_CONSULTATION',
      },
    });
    return { success: true, message: 'Queue resumed' };
  }

  private extractOwnerIdFromQueueKey(queueKey: string): string {
    const parts = queueKey.split(':');
    return parts.length >= 5 ? parts[3] || '' : '';
  }

  private mapTargetQueueToCategory(targetQueue: string): string {
    switch (targetQueue) {
      case 'DOCTOR_CONSULTATION':
      case 'CONSULTATION':
        return 'DOCTOR_CONSULTATION';
      case 'THERAPY_PROCEDURE':
      case 'THERAPY':
        return 'THERAPY_PROCEDURE';
      case 'MEDICINE_DESK':
      case 'PHARMACY':
        return 'MEDICINE_DESK';
      default:
        return targetQueue;
    }
  }

  private resolveQueueEntryType(queueCategory: string, treatmentType?: string): string {
    if (treatmentType) return String(treatmentType).trim().toUpperCase();
    if (queueCategory === 'DOCTOR_CONSULTATION') return 'CONSULTATION';
    if (queueCategory === 'THERAPY_PROCEDURE') return 'THERAPY';
    if (queueCategory === 'MEDICINE_DESK') return 'MEDICINE_DESK';
    return '';
  }
}
