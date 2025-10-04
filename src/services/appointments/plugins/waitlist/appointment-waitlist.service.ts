import { Injectable, Logger } from "@nestjs/common";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { PrismaService } from "../../../../libs/infrastructure/database/prisma/prisma.service";

export interface WaitlistEntry {
  id: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  preferredDate: Date;
  preferredTime?: string;
  priority: "low" | "normal" | "high" | "urgent";
  reason: string;
  status: "waiting" | "notified" | "scheduled" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
  notifiedAt?: Date;
  scheduledAt?: Date;
}

export interface WaitlistMetrics {
  totalEntries: number;
  entriesByPriority: Record<string, number>;
  entriesByStatus: Record<string, number>;
  averageWaitTime: number;
  notificationRate: number;
  schedulingRate: number;
}

@Injectable()
export class AppointmentWaitlistService {
  private readonly logger = new Logger(AppointmentWaitlistService.name);
  private readonly WAITLIST_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
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
    priority: "low" | "normal" | "high" | "urgent" = "normal",
    preferredTime?: string,
  ): Promise<WaitlistEntry> {
    const entryId = `waitlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const entry: WaitlistEntry = {
      id: entryId,
      patientId,
      doctorId,
      clinicId,
      preferredDate,
      preferredTime,
      priority,
      reason,
      status: "waiting",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      // Cache the waitlist entry
      const cacheKey = `waitlist_entry:${entryId}`;
      await this.cacheService.set(cacheKey, entry, this.WAITLIST_CACHE_TTL);

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(doctorId, clinicId);

      this.logger.log(`Added patient to waitlist`, {
        entryId,
        patientId,
        doctorId,
        clinicId,
        priority,
        reason,
      });

      return entry;
    } catch (_error) {
      this.logger.error(`Failed to add to waitlist`, {
        patientId,
        doctorId,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get waitlist for doctor/clinic
   */
  async getWaitlist(
    doctorId?: string,
    clinicId?: string,
    status?: string,
  ): Promise<WaitlistEntry[]> {
    const cacheKey = `waitlist:${doctorId || "all"}:${clinicId || "all"}:${status || "all"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as WaitlistEntry[];
      }

      // Get waitlist entries from database
      const entries = await this.prisma.waitlistEntry.findMany({
        where: {
          ...(doctorId ? { doctorId } : {}),
          ...(clinicId ? { clinicId } : {}),
          ...(status ? { status } : {}),
        },
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
      });

      const waitlistEntries: WaitlistEntry[] = entries.map(
        (entry: unknown) => ({
          id: (entry as any).id,
          patientId: (entry as any).patientId,
          doctorId: (entry as any).doctorId,
          clinicId: (entry as any).clinicId,
          preferredDate: (entry as any).requestedDate,
          preferredTime: "10:00", // Default time, could be stored in database
          priority: (entry as any).priority === 1 ? "high" : "normal",
          reason: (entry as any).notes || "No reason provided",
          status: (entry as any).status,
          createdAt: (entry as any).createdAt,
          updatedAt: (entry as any).updatedAt,
        }),
      );

      await this.cacheService.set(
        cacheKey,
        waitlistEntries,
        this.WAITLIST_CACHE_TTL,
      );
      return waitlistEntries;
    } catch (_error) {
      this.logger.error(`Failed to get waitlist`, {
        doctorId,
        clinicId,
        status,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Process waitlist automatically
   */
  async processWaitlist(
    doctorId: string,
    clinicId: string,
  ): Promise<{
    processed: number;
    scheduled: number;
    notified: number;
  }> {
    try {
      const waitlist = await this.getWaitlist(doctorId, clinicId, "waiting");
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
          entry.preferredTime,
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

      this.logger.log(`Processed waitlist for doctor ${doctorId}`, {
        processed,
        scheduled,
        notified,
      });

      return { processed, scheduled, notified };
    } catch (_error) {
      this.logger.error(`Failed to process waitlist`, {
        doctorId,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Check if appointment slot is available
   */
  private async checkSlotAvailability(
    doctorId: string,
    date: Date,
    time?: string,
  ): Promise<boolean> {
    try {
      // Check if doctor has any appointments on this date
      const existingAppointments = await this.prisma.appointment.count({
        where: {
          doctorId,
          date: {
            gte: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
            lt: new Date(
              date.getFullYear(),
              date.getMonth(),
              date.getDate() + 1,
            ),
          },
          status: {
            in: ["SCHEDULED", "CONFIRMED", "IN_PROGRESS"],
          },
        },
      });

      // Get doctor's working hours and capacity
      const doctor = await this.prisma.doctor.findUnique({
        where: { id: doctorId },
        include: {
          clinic: {
            select: {
              workingHours: true,
              maxAppointmentsPerDay: true,
            },
          },
        },
      });

      if (!doctor) {
        return false;
      }

      // Check if doctor has reached daily capacity
      const maxAppointments = doctor.clinic.maxAppointmentsPerDay || 20;
      if (existingAppointments >= maxAppointments) {
        return false;
      }

      // Check if the requested time is within working hours
      if (time) {
        const requestedHour = parseInt(time.split(":")[0]);
        const workingHours = doctor.clinic.workingHours || {
          start: "09:00",
          end: "17:00",
        };
        const startHour = parseInt(workingHours.start.split(":")[0]);
        const endHour = parseInt(workingHours.end.split(":")[0]);

        if (requestedHour < startHour || requestedHour >= endHour) {
          return false;
        }
      }

      return true;
    } catch (_error) {
      this.logger.error(`Failed to check slot availability`, {
        doctorId,
        date,
        time,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
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
        status: "scheduled" as const,
        scheduledAt: new Date(),
        updatedAt: new Date(),
      };

      // Cache updated entry
      const cacheKey = `waitlist_entry:${entry.id}`;
      await this.cacheService.set(
        cacheKey,
        updatedEntry,
        this.WAITLIST_CACHE_TTL,
      );

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      this.logger.log(`Scheduled appointment from waitlist`, {
        entryId: entry.id,
        patientId: entry.patientId,
        doctorId: entry.doctorId,
      });
    } catch (_error) {
      this.logger.error(`Failed to schedule from waitlist`, {
        entryId: entry.id,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
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
        status: "notified" as const,
        notifiedAt: new Date(),
        updatedAt: new Date(),
      };

      // Cache updated entry
      const cacheKey = `waitlist_entry:${entry.id}`;
      await this.cacheService.set(
        cacheKey,
        updatedEntry,
        this.WAITLIST_CACHE_TTL,
      );

      // Invalidate waitlist cache
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      this.logger.log(`Notified waitlist patient`, {
        entryId: entry.id,
        patientId: entry.patientId,
        priority: entry.priority,
      });
    } catch (_error) {
      this.logger.error(`Failed to notify waitlist patient`, {
        entryId: entry.id,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Get waitlist metrics
   */
  async getWaitlistMetrics(
    doctorId?: string,
    clinicId?: string,
  ): Promise<WaitlistMetrics> {
    try {
      const waitlist = await this.getWaitlist(doctorId, clinicId);

      const totalEntries = waitlist.length;
      const entriesByPriority = waitlist.reduce(
        (acc, entry) => {
          acc[entry.priority] = (acc[entry.priority] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const entriesByStatus = waitlist.reduce(
        (acc, entry) => {
          acc[entry.status] = (acc[entry.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const averageWaitTime = this.calculateAverageWaitTime(waitlist);
      const notificationRate = this.calculateNotificationRate(waitlist);
      const schedulingRate = this.calculateSchedulingRate(waitlist);

      return {
        totalEntries,
        entriesByPriority,
        entriesByStatus,
        averageWaitTime,
        notificationRate,
        schedulingRate,
      };
    } catch (_error) {
      this.logger.error(`Failed to get waitlist metrics`, {
        doctorId,
        clinicId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Calculate average wait time
   */
  private calculateAverageWaitTime(waitlist: WaitlistEntry[]): number {
    const now = new Date();
    const waitingEntries = waitlist.filter(
      (entry) => entry.status === "waiting",
    );

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
    const notifiedEntries = waitlist.filter(
      (entry) => entry.status === "notified",
    ).length;
    return waitlist.length > 0 ? (notifiedEntries / waitlist.length) * 100 : 0;
  }

  /**
   * Calculate scheduling rate
   */
  private calculateSchedulingRate(waitlist: WaitlistEntry[]): number {
    const scheduledEntries = waitlist.filter(
      (entry) => entry.status === "scheduled",
    ).length;
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

        this.logger.log(`Removed from waitlist`, {
          entryId,
          patientId: entry.patientId,
          doctorId: entry.doctorId,
        });
      }
    } catch (_error) {
      this.logger.error(`Failed to remove from waitlist`, {
        entryId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Update waitlist entry
   */
  async updateWaitlistEntry(
    entryId: string,
    updateData: Partial<WaitlistEntry>,
  ): Promise<WaitlistEntry> {
    try {
      const cacheKey = `waitlist_entry:${entryId}`;
      const entry = (await this.cacheService.get(cacheKey)) as WaitlistEntry;

      if (!entry) {
        throw new Error("Waitlist entry not found");
      }

      const updatedEntry = {
        ...entry,
        ...updateData,
        updatedAt: new Date(),
      };

      await this.cacheService.set(
        cacheKey,
        updatedEntry,
        this.WAITLIST_CACHE_TTL,
      );
      await this.invalidateWaitlistCache(entry.doctorId, entry.clinicId);

      this.logger.log(`Updated waitlist entry`, {
        entryId,
        updates: Object.keys(updateData),
      });

      return updatedEntry;
    } catch (_error) {
      this.logger.error(`Failed to update waitlist entry`, {
        entryId,
        _error: _error instanceof Error ? _error.message : String(_error),
      });
      throw _error;
    }
  }

  /**
   * Invalidate waitlist cache
   */
  private async invalidateWaitlistCache(
    doctorId: string,
    clinicId: string,
  ): Promise<void> {
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
