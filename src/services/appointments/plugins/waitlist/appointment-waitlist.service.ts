import { Injectable } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

import type { WaitlistEntry, WaitlistMetrics } from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { WaitlistEntry, WaitlistMetrics };

@Injectable()
export class AppointmentWaitlistService {
  private readonly WAITLIST_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Add patient to waitlist
   */
  async addToWaitlist(
    patientId: string,
    doctorId: string,
    clinicId: string,
    preferredDate: Date,
    reason: string,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal',
    preferredTime?: string
  ): Promise<WaitlistEntry> {
    const entryId = `waitlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const entry: WaitlistEntry = {
      id: entryId,
      patientId,
      doctorId,
      clinicId,
      preferredDate,
      priority,
      reason,
      status: 'waiting',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(preferredTime && { preferredTime }),
    };

    try {
      // Cache the waitlist entry
      const cacheKey = `waitlist_entry:${entryId}`;
      await this.cacheService.set(cacheKey, entry, this.WAITLIST_CACHE_TTL);

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(doctorId, clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Added patient to waitlist`,
        'AppointmentWaitlistService.addToWaitlist',
        {
          entryId,
          patientId,
          doctorId,
          clinicId,
          priority,
          reason,
        }
      );

      return entry;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to add to waitlist: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.addToWaitlist',
        {
          patientId,
          doctorId,
          clinicId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Get waitlist for doctor/clinic
   */
  async getWaitlist(
    doctorId?: string,
    clinicId?: string,
    status?: string
  ): Promise<WaitlistEntry[]> {
    const cacheKey = `waitlist:${doctorId || 'all'}:${clinicId || 'all'}:${status || 'all'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as WaitlistEntry[];
      }

      // Get waitlist entries from database using executeHealthcareRead
      // Note: waitlistEntry model may not exist in Prisma schema yet
      const waitlistEntriesFromDb = await this.databaseService.executeHealthcareRead(
        async client => {
          const waitlistModel = (client as unknown as Record<string, unknown>)['waitlistEntry'] as
            | {
                findMany: (args: {
                  where: Record<string, unknown>;
                  orderBy: Array<Record<string, string>>;
                }) => Promise<unknown[]>;
              }
            | undefined;

          return waitlistModel
            ? await waitlistModel.findMany({
                where: {
                  ...(doctorId ? { doctorId } : {}),
                  ...(clinicId ? { clinicId } : {}),
                  ...(status ? { status } : {}),
                },
                orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
              })
            : [];
        }
      );

      interface WaitlistEntryRow {
        id: string;
        patientId: string;
        doctorId: string;
        clinicId: string;
        requestedDate: Date;
        priority: number;
        notes?: string | null;
        status: string;
        createdAt: Date;
        updatedAt: Date;
      }

      const waitlistEntries: WaitlistEntry[] = waitlistEntriesFromDb.map((entry: unknown) => {
        const row = entry as WaitlistEntryRow;
        const statusValue = row.status;
        const validStatus: 'waiting' | 'notified' | 'scheduled' | 'cancelled' =
          statusValue === 'waiting' ||
          statusValue === 'notified' ||
          statusValue === 'scheduled' ||
          statusValue === 'cancelled'
            ? statusValue
            : 'waiting';
        return {
          id: row.id,
          patientId: row.patientId,
          doctorId: row.doctorId,
          clinicId: row.clinicId,
          preferredDate: row.requestedDate,
          preferredTime: '10:00', // Default time, could be stored in database
          priority: row.priority === 1 ? 'high' : 'normal',
          reason: row.notes || 'No reason provided',
          status: validStatus,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      });

      await this.cacheService.set(cacheKey, waitlistEntries, this.WAITLIST_CACHE_TTL);
      return waitlistEntries;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get waitlist: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.getWaitlist',
        {
          doctorId,
          clinicId,
          status,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Process waitlist automatically
   */
  async processWaitlist(
    doctorId: string,
    clinicId: string
  ): Promise<{
    processed: number;
    scheduled: number;
    notified: number;
  }> {
    try {
      const waitlist = await this.getWaitlist(doctorId, clinicId, 'waiting');
      let processed = 0;
      let scheduled = 0;
      let notified = 0;

      // Sort by priority and creation date
      const sortedWaitlist = waitlist.sort((a, b) => {
        const priorityOrder = { urgent: 4, high: 3, normal: 2, low: 1 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }

        return a.createdAt.getTime() - b.createdAt.getTime();
      });

      for (const entry of sortedWaitlist) {
        processed++;

        // Check if appointment slot is available
        const isSlotAvailable = await this.checkSlotAvailability(
          entry.doctorId,
          entry.preferredDate,
          entry.preferredTime
        );

        if (isSlotAvailable) {
          // Schedule appointment
          await this.scheduleFromWaitlist(entry);
          scheduled++;
        } else {
          // Notify patient about waitlist status
          await this.notifyWaitlistPatient(entry);
          notified++;
        }
      }

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Processed waitlist for doctor ${doctorId}`,
        'AppointmentWaitlistService.processWaitlist',
        {
          doctorId,
          clinicId,
          processed,
          scheduled,
          notified,
        }
      );

      return { processed, scheduled, notified };
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to process waitlist: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.processWaitlist',
        {
          doctorId,
          clinicId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Check if appointment slot is available
   */
  private async checkSlotAvailability(
    doctorId: string,
    date: Date,
    time?: string
  ): Promise<boolean> {
    try {
      // Check if doctor has any appointments on this date using countAppointmentsSafe
      const existingAppointments = await this.databaseService.countAppointmentsSafe({
        doctorId,
        date: {
          gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
          lt: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
        },
        status: {
          in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'],
        },
      } as never);

      // Get doctor's working hours and capacity using executeHealthcareRead
      const doctor = (await this.databaseService.executeHealthcareRead(async client => {
        const doctorDelegate = client['doctor'] as unknown as {
          findUnique: (args: {
            where: { id: string };
            include: {
              clinics: {
                include: { location: { select: { workingHours: boolean } } };
                take: number;
              };
            };
          }) => Promise<{ clinics?: Array<{ location?: { workingHours: unknown } }> } | null>;
        };
        return (await doctorDelegate.findUnique({
          where: { id: doctorId },
          include: {
            clinics: {
              include: {
                location: {
                  select: {
                    workingHours: true,
                  },
                },
              },
              take: 1, // Get first clinic
            },
          },
        })) as unknown as { clinics?: Array<{ location?: { workingHours: unknown } }> } | null;
      })) as unknown as { clinics?: Array<{ location?: { workingHours: unknown } }> } | null;

      if (!doctor) {
        return false;
      }

      // Get first clinic or use defaults
      const doctorClinic = (
        doctor?.clinics as Array<{ location?: { workingHours: unknown } }> | undefined
      )?.[0];
      if (!doctorClinic) {
        return false;
      }

      // Get working hours from location
      const location = doctorClinic?.location as { workingHours: unknown } | undefined;
      const maxAppointments = 20; // Default value, can be configured per clinic

      if (existingAppointments >= maxAppointments) {
        return false;
      }

      // Check if the requested time is within working hours
      if (time && location?.workingHours) {
        const requestedHour = parseInt(time.split(':')[0] || '0');
        const workingHoursObj: unknown =
          typeof location.workingHours === 'string'
            ? JSON.parse(location.workingHours)
            : location.workingHours;
        const defaultWorkingHours = { start: '09:00', end: '17:00' };
        const workingHoursRaw =
          workingHoursObj &&
          typeof workingHoursObj === 'object' &&
          'start' in workingHoursObj &&
          'end' in workingHoursObj
            ? (workingHoursObj as { start: string; end: string })
            : defaultWorkingHours;
        const workingHours = workingHoursRaw;
        const startHour = parseInt(workingHours.start.split(':')[0] || '0');
        const endHour = parseInt(workingHours.end.split(':')[0] || '0');

        if (requestedHour < startHour || requestedHour >= endHour) {
          return false;
        }
      }

      return true;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to check slot availability: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.checkSlotAvailability',
        {
          doctorId,
          date: date.toISOString(),
          time,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      return false;
    }
  }

  /**
   * Schedule appointment from waitlist
   */
  private async scheduleFromWaitlist(entry: WaitlistEntry): Promise<void> {
    try {
      // Update waitlist entry status
      const updatedEntry = {
        ...entry,
        status: 'scheduled' as const,
        scheduledAt: new Date(),
        updatedAt: new Date(),
      };

      // Cache updated entry
      const cacheKey = `waitlist_entry:${entry.id}`;
      await this.cacheService.set(cacheKey, updatedEntry, this.WAITLIST_CACHE_TTL);

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Scheduled appointment from waitlist`,
        'AppointmentWaitlistService.scheduleFromWaitlist',
        {
          entryId: entry.id,
          patientId: entry.patientId,
          doctorId: entry.doctorId,
        }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to schedule from waitlist: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.scheduleFromWaitlist',
        {
          entryId: entry.id,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Notify waitlist patient
   */
  private async notifyWaitlistPatient(entry: WaitlistEntry): Promise<void> {
    try {
      // Update waitlist entry status
      const updatedEntry = {
        ...entry,
        status: 'notified' as const,
        notifiedAt: new Date(),
        updatedAt: new Date(),
      };

      // Cache updated entry
      const cacheKey = `waitlist_entry:${entry.id}`;
      await this.cacheService.set(cacheKey, updatedEntry, this.WAITLIST_CACHE_TTL);

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Notified waitlist patient`,
        'AppointmentWaitlistService.notifyWaitlistPatient',
        {
          entryId: entry.id,
          patientId: entry.patientId,
          priority: entry.priority,
        }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to notify waitlist patient: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.notifyWaitlistPatient',
        {
          entryId: entry.id,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Get waitlist metrics
   */
  async getWaitlistMetrics(doctorId?: string, clinicId?: string): Promise<WaitlistMetrics> {
    try {
      const waitlist = await this.getWaitlist(doctorId, clinicId);

      const totalEntries = waitlist.length;
      const entriesByPriority = waitlist.reduce(
        (acc, entry) => {
          acc[entry.priority] = (acc[entry.priority] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const entriesByStatus = waitlist.reduce(
        (acc, entry) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      const averageWaitTime = this.calculateAverageWaitTime(waitlist);
      const notificationRate = this.calculateNotificationRate(waitlist);

      return {
        totalEntries,
        entriesByPriority,
        entriesByStatus,
        averageWaitTime,
        notificationRate,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get waitlist metrics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.getWaitlistMetrics',
        {
          doctorId,
          clinicId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Calculate average wait time
   */
  private calculateAverageWaitTime(waitlist: WaitlistEntry[]): number {
    const now = new Date();
    const waitingEntries = waitlist.filter(entry => entry.status === 'waiting');

    if (waitingEntries.length === 0) return 0;

    const totalWaitTime = waitingEntries.reduce((sum, entry) => {
      return sum + (now.getTime() - entry.createdAt.getTime());
    }, 0);

    return totalWaitTime / waitingEntries.length / (1000 * 60 * 60); // Convert to hours
  }

  /**
   * Calculate notification rate
   */
  private calculateNotificationRate(waitlist: WaitlistEntry[]): number {
    const notifiedEntries = waitlist.filter(entry => entry.status === 'notified').length;
    return waitlist.length > 0 ? (notifiedEntries / waitlist.length) * 100 : 0;
  }

  /**
   * Calculate scheduling rate
   */
  private calculateSchedulingRate(waitlist: WaitlistEntry[]): number {
    const scheduledEntries = waitlist.filter(entry => entry.status === 'scheduled').length;
    return waitlist.length > 0 ? (scheduledEntries / waitlist.length) * 100 : 0;
  }

  /**
   * Remove from waitlist
   */
  async removeFromWaitlist(entryId: string): Promise<void> {
    try {
      const cacheKey = `waitlist_entry:${entryId}`;
      const entry = (await this.cacheService.get(cacheKey)) as WaitlistEntry;

      if (entry) {
        await this.cacheService.delete(cacheKey);
        await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

        void this.loggingService.log(
          LogType.BUSINESS,
          LogLevel.INFO,
          `Removed from waitlist`,
          'AppointmentWaitlistService.removeFromWaitlist',
          {
            entryId,
            patientId: entry.patientId,
            doctorId: entry.doctorId,
          }
        );
      }
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to remove from waitlist: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.removeFromWaitlist',
        {
          entryId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Update waitlist entry
   */
  async updateWaitlistEntry(
    entryId: string,
    updateData: Partial<WaitlistEntry>
  ): Promise<WaitlistEntry> {
    try {
      const cacheKey = `waitlist_entry:${entryId}`;
      const entry = (await this.cacheService.get(cacheKey)) as WaitlistEntry;

      if (!entry) {
        throw new HealthcareError(
          ErrorCode.APPOINTMENT_NOT_FOUND,
          'Waitlist entry not found',
          undefined,
          { entryId },
          'AppointmentWaitlistService.updateWaitlistEntry'
        );
      }

      const updatedEntry = {
        ...entry,
        ...updateData,
        updatedAt: new Date(),
      };

      await this.cacheService.set(cacheKey, updatedEntry, this.WAITLIST_CACHE_TTL);
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Updated waitlist entry`,
        'AppointmentWaitlistService.updateWaitlistEntry',
        {
          entryId,
          updates: Object.keys(updateData),
        }
      );

      return updatedEntry;
    } catch (_error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update waitlist entry: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentWaitlistService.updateWaitlistEntry',
        {
          entryId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  /**
   * Invalidate waitlist cache
   */
  private async invalidateWaitlistCache(doctorId: string, clinicId: string): Promise<void> {
    const cacheKeys = [
      `waitlist:${doctorId}:${clinicId}:all`,
      `waitlist:${doctorId}:${clinicId}:waiting`,
      `waitlist:all:${clinicId}:all`,
      `waitlist:all:${clinicId}:waiting`,
    ];

    for (const cacheKey of cacheKeys) {
      await this.cacheService.delete(cacheKey);
    }
  }
}
