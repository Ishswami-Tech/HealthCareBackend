/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../../../libs/infrastructure/database";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { LogType, LogLevel } from "../../../../libs/infrastructure/logging";
import {
  TherapyType,
  TherapyDuration,
  TherapyStatus,
} from "../../../../libs/infrastructure/database/prisma/prisma.types";

// Local type definitions for Ayurvedic Therapy models
export interface AyurvedicTherapy {
  id: string;
  name: string;
  description?: string | null;
  therapyType: TherapyType;
  duration: TherapyDuration;
  estimatedDuration: number;
  isActive: boolean;
  clinicId: string;
  createdAt: Date;
  updatedAt: Date;
  sessions?: TherapySession[];
}

export interface TherapySession {
  id: string;
  therapyId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  scheduledDate: Date;
  startTime?: Date | null;
  endTime?: Date | null;
  status: TherapyStatus;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTherapyDto {
  name: string;
  description?: string;
  therapyType: TherapyType;
  duration: TherapyDuration;
  estimatedDuration: number; // in minutes
  clinicId: string;
}

export interface UpdateTherapyDto {
  name?: string;
  description?: string;
  therapyType?: TherapyType;
  duration?: TherapyDuration;
  estimatedDuration?: number;
  isActive?: boolean;
}

export interface CreateTherapySessionDto {
  therapyId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  sessionDate: Date;
  startTime: Date;
  notes?: string;
  observations?: Record<string, unknown>;
}

export interface UpdateTherapySessionDto {
  endTime?: Date;
  status?: TherapyStatus;
  notes?: string;
  observations?: Record<string, unknown>;
  nextSessionDate?: Date;
}

@Injectable()
export class AyurvedicTherapyService {
  private readonly logger = new Logger(AyurvedicTherapyService.name);
  private readonly THERAPY_CACHE_TTL = 3600; // 1 hour
  private readonly SESSION_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Create a new Ayurvedic therapy
   */
  async createTherapy(data: CreateTherapyDto): Promise<AyurvedicTherapy> {
    const startTime = Date.now();

    try {
      const therapy = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.create({
          data: {
            name: data.name,
            description: data.description,
            therapyType: data.therapyType,
            duration: data.duration,
            estimatedDuration: data.estimatedDuration,
            clinicId: data.clinicId,
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(
        `therapies:clinic:${data.clinicId}*`,
      );

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Ayurvedic therapy created successfully",
        "AyurvedicTherapyService",
        {
          therapyId: therapy.id,
          therapyType: data.therapyType,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        },
      );

      return therapy;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get all therapies for a clinic
   */
  async getClinicTherapies(
    clinicId: string,
    isActive?: boolean,
  ): Promise<AyurvedicTherapy[]> {
    const startTime = Date.now();
    const cacheKey = `therapies:clinic:${clinicId}:${isActive ?? "all"}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const therapies = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.findMany({
          where: {
            clinicId,
            ...(isActive !== undefined && { isActive }),
          },
          include: {
            sessions: {
              take: 10,
              orderBy: { sessionDate: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(therapies),
        this.THERAPY_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Clinic therapies retrieved successfully",
        "AyurvedicTherapyService",
        {
          clinicId,
          count: therapies.length,
          responseTime: Date.now() - startTime,
        },
      );

      return therapies;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic therapies: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get therapies by type
   */
  async getTherapiesByType(
    clinicId: string,
    therapyType: TherapyType,
  ): Promise<AyurvedicTherapy[]> {
    const startTime = Date.now();
    const cacheKey = `therapies:clinic:${clinicId}:type:${therapyType}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const therapies = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.findMany({
          where: {
            clinicId,
            therapyType,
            isActive: true,
          },
          orderBy: { name: "asc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(therapies),
        this.THERAPY_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Therapies by type retrieved successfully",
        "AyurvedicTherapyService",
        {
          clinicId,
          therapyType,
          count: therapies.length,
          responseTime: Date.now() - startTime,
        },
      );

      return therapies;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapies by type: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
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
   * Get therapy by ID
   */
  async getTherapyById(therapyId: string): Promise<AyurvedicTherapy> {
    const startTime = Date.now();
    const cacheKey = `therapy:${therapyId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const therapy = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.findUnique({
          where: { id: therapyId },
          include: {
            sessions: {
              orderBy: { sessionDate: "desc" },
              take: 20,
            },
          },
        });

      if (!therapy) {
        throw new NotFoundException(`Therapy with ID ${therapyId} not found`);
      }

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(therapy),
        this.THERAPY_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Therapy retrieved successfully",
        "AyurvedicTherapyService",
        {
          therapyId,
          responseTime: Date.now() - startTime,
        },
      );

      return therapy;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapy: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Update therapy
   */
  async updateTherapy(
    therapyId: string,
    data: UpdateTherapyDto,
  ): Promise<AyurvedicTherapy> {
    const startTime = Date.now();

    try {
      const therapy = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.update({
          where: { id: therapyId },
          data,
        });

      // Invalidate cache
      await this.cacheService.del(`therapy:${therapyId}`);
      await this.cacheService.invalidateByPattern(
        `therapies:clinic:${therapy.clinicId}*`,
      );

      this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Therapy updated successfully",
        "AyurvedicTherapyService",
        {
          therapyId,
          responseTime: Date.now() - startTime,
        },
      );

      return therapy;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update therapy: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Delete therapy
   */
  async deleteTherapy(therapyId: string): Promise<void> {
    const startTime = Date.now();

    try {
      const therapy = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.findUnique({
          where: { id: therapyId },
        });

      if (!therapy) {
        throw new NotFoundException(`Therapy with ID ${therapyId} not found`);
      }

      await this.databaseService.getPrismaClient().ayurvedicTherapy.delete({
        where: { id: therapyId },
      });

      // Invalidate cache
      await this.cacheService.del(`therapy:${therapyId}`);
      await this.cacheService.invalidateByPattern(
        `therapies:clinic:${therapy.clinicId}*`,
      );

      this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Therapy deleted successfully",
        "AyurvedicTherapyService",
        {
          therapyId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete therapy: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  // =============================================
  // THERAPY SESSION MANAGEMENT
  // =============================================

  /**
   * Create therapy session
   */
  async createTherapySession(
    data: CreateTherapySessionDto,
  ): Promise<TherapySession> {
    const startTime = Date.now();

    try {
      // Validate therapy exists
      const therapy = await this.databaseService
        .getPrismaClient()
        .ayurvedicTherapy.findUnique({
          where: { id: data.therapyId },
        });

      if (!therapy) {
        throw new NotFoundException(
          `Therapy with ID ${data.therapyId} not found`,
        );
      }

      const session = await this.databaseService
        .getPrismaClient()
        .therapySession.create({
          data: {
            therapyId: data.therapyId,
            appointmentId: data.appointmentId,
            patientId: data.patientId,
            doctorId: data.doctorId,
            clinicId: data.clinicId,
            sessionDate: data.sessionDate,
            startTime: data.startTime,
            notes: data.notes,
            observations: data.observations as any,
            status: TherapyStatus.SCHEDULED,
          },
          include: {
            therapy: true,
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
            doctor: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(
        `therapy-sessions:*:${data.clinicId}*`,
      );
      await this.cacheService.invalidateByPattern(
        `therapy-sessions:patient:${data.patientId}*`,
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Therapy session created successfully",
        "AyurvedicTherapyService",
        {
          sessionId: session.id,
          therapyId: data.therapyId,
          patientId: data.patientId,
          responseTime: Date.now() - startTime,
        },
      );

      return session;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy session: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get therapy sessions for a patient
   */
  async getPatientTherapySessions(
    patientId: string,
    clinicId: string,
  ): Promise<TherapySession[]> {
    const startTime = Date.now();
    const cacheKey = `therapy-sessions:patient:${patientId}:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const sessions = await this.databaseService
        .getPrismaClient()
        .therapySession.findMany({
          where: {
            patientId,
            clinicId,
          },
          include: {
            therapy: true,
            doctor: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
          orderBy: { sessionDate: "desc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(sessions),
        this.SESSION_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Patient therapy sessions retrieved successfully",
        "AyurvedicTherapyService",
        {
          patientId,
          clinicId,
          count: sessions.length,
          responseTime: Date.now() - startTime,
        },
      );

      return sessions;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient therapy sessions: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          patientId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get therapy sessions for a doctor
   */
  async getDoctorTherapySessions(
    doctorId: string,
    clinicId: string,
    date?: Date,
  ): Promise<TherapySession[]> {
    const startTime = Date.now();
    const dateStr = date ? date.toISOString().split("T")[0] : "all";
    const cacheKey = `therapy-sessions:doctor:${doctorId}:clinic:${clinicId}:date:${dateStr}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const whereClause: any = {
        doctorId,
        clinicId,
      };

      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        whereClause.sessionDate = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }

      const sessions = await this.databaseService
        .getPrismaClient()
        .therapySession.findMany({
          where: whereClause,
          include: {
            therapy: true,
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
          orderBy: { sessionDate: "asc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(sessions),
        this.SESSION_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Doctor therapy sessions retrieved successfully",
        "AyurvedicTherapyService",
        {
          doctorId,
          clinicId,
          date: dateStr,
          count: sessions.length,
          responseTime: Date.now() - startTime,
        },
      );

      return sessions;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor therapy sessions: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          doctorId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Update therapy session
   */
  async updateTherapySession(
    sessionId: string,
    data: UpdateTherapySessionDto,
  ): Promise<TherapySession> {
    const startTime = Date.now();

    try {
      const session = await this.databaseService
        .getPrismaClient()
        .therapySession.update({
          where: { id: sessionId },
          data: {
            ...data,
            observations: data.observations as any,
          },
          include: {
            therapy: true,
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
            doctor: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                  },
                },
              },
            },
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(
        `therapy-sessions:*:${session.clinicId}*`,
      );
      await this.cacheService.invalidateByPattern(
        `therapy-sessions:patient:${session.patientId}*`,
      );
      await this.cacheService.invalidateByPattern(
        `therapy-sessions:doctor:${session.doctorId}*`,
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Therapy session updated successfully",
        "AyurvedicTherapyService",
        {
          sessionId,
          status: data.status,
          responseTime: Date.now() - startTime,
        },
      );

      return session;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update therapy session: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          sessionId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Start therapy session
   */
  async startTherapySession(sessionId: string): Promise<TherapySession> {
    return this.updateTherapySession(sessionId, {
      status: TherapyStatus.IN_PROGRESS,
      // startTime is already set when created, no need to update
    });
  }

  /**
   * Complete therapy session
   */
  async completeTherapySession(
    sessionId: string,
    notes?: string,
    observations?: Record<string, unknown>,
    nextSessionDate?: Date,
  ): Promise<TherapySession> {
    return this.updateTherapySession(sessionId, {
      status: TherapyStatus.COMPLETED,
      endTime: new Date(),
      ...(notes && { notes }),
      ...(observations && { observations }),
      ...(nextSessionDate && { nextSessionDate }),
    });
  }

  /**
   * Cancel therapy session
   */
  async cancelTherapySession(
    sessionId: string,
    notes?: string,
  ): Promise<TherapySession> {
    return this.updateTherapySession(sessionId, {
      status: TherapyStatus.CANCELLED,
      ...(notes && { notes }),
    });
  }

  /**
   * Get therapy session statistics
   */
  async getTherapySessionStats(
    clinicId: string,
    therapyId?: string,
  ): Promise<{
    total: number;
    scheduled: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    averageDuration: number;
  }> {
    const startTime = Date.now();

    try {
      const whereClause: any = { clinicId };
      if (therapyId) {
        whereClause.therapyId = therapyId;
      }

      const sessions = await this.databaseService
        .getPrismaClient()
        .therapySession.findMany({
          where: whereClause,
          select: {
            status: true,
            startTime: true,
            endTime: true,
          },
        });

      type SessionWithStatus = { status: TherapyStatus };
      const sessionsTyped = sessions as SessionWithStatus[];
      const stats = {
        total: sessions.length,
        scheduled: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.SCHEDULED,
        ).length,
        inProgress: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.IN_PROGRESS,
        ).length,
        completed: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.COMPLETED,
        ).length,
        cancelled: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.CANCELLED,
        ).length,
        averageDuration: 0,
      };

      // Calculate average duration for completed sessions
      type SessionWithTimes = {
        status: TherapyStatus;
        endTime?: Date | null;
        startTime?: Date | null;
      };
      const completedSessions = sessions.filter(
        (s: SessionWithTimes) =>
          s.status === TherapyStatus.COMPLETED && s.endTime && s.startTime,
      ) as SessionWithTimes[];

      if (completedSessions.length > 0) {
        const totalDuration = completedSessions.reduce(
          (sum: number, session: SessionWithTimes) => {
            if (!session.endTime || !session.startTime) return sum;
            const duration =
              (new Date(session.endTime).getTime() -
                new Date(session.startTime).getTime()) /
              60000; // minutes
            return sum + duration;
          },
          0,
        );
        stats.averageDuration = Math.round(
          totalDuration / completedSessions.length,
        );
      }

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Therapy session stats retrieved successfully",
        "AyurvedicTherapyService",
        {
          clinicId,
          therapyId,
          stats,
          responseTime: Date.now() - startTime,
        },
      );

      return stats;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapy session stats: ${error instanceof Error ? error.message : String(error)}`,
        "AyurvedicTherapyService",
        {
          clinicId,
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */
