import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { TherapyType, TherapyDuration, TherapyStatus } from '@core/types/enums.types';
import type {
  AyurvedicTherapy,
  TherapySession,
  CreateTherapyDto,
  UpdateTherapyDto,
  CreateTherapySessionDto,
  UpdateTherapySessionDto,
} from '@core/types/appointment.types';

@Injectable()
export class AyurvedicTherapyService {
  private readonly logger = new Logger(AyurvedicTherapyService.name);
  private readonly THERAPY_CACHE_TTL = 3600; // 1 hour
  private readonly SESSION_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Create a new Ayurvedic therapy
   */
  async createTherapy(data: CreateTherapyDto): Promise<AyurvedicTherapy> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareWrite for create with audit logging
      const therapy = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              ayurvedicTherapy: {
                create: <T>(args: T) => Promise<AyurvedicTherapy>;
              };
            }
          ).ayurvedicTherapy.create({
            data: {
              name: data.name,
              description: data.description,
              therapyType: data.therapyType,
              duration: data.duration,
              estimatedDuration: data.estimatedDuration,
              clinicId: data.clinicId,
            },
          } as never);
        },
        {
          userId: 'system',
          clinicId: data.clinicId,
          resourceType: 'AYURVEDIC_THERAPY',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: data.name, therapyType: data.therapyType, clinicId: data.clinicId },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);

      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Ayurvedic therapy created successfully',
        'AyurvedicTherapyService',
        {
          therapyId: therapy.id,
          therapyType: data.therapyType,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        }
      );

      return therapy;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get all therapies for a clinic
   */
  async getClinicTherapies(clinicId: string, isActive?: boolean): Promise<AyurvedicTherapy[]> {
    const startTime = Date.now();
    const cacheKey = `therapies:clinic:${clinicId}:${isActive ?? 'all'}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Use executeHealthcareRead for optimized query
      const therapies = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            ayurvedicTherapy: {
              findMany: <T>(args: T) => Promise<AyurvedicTherapy[]>;
            };
          }
        ).ayurvedicTherapy.findMany({
          where: {
            clinicId,
            ...(isActive !== undefined && { isActive }),
          },
          include: {
            sessions: {
              take: 10,
              orderBy: { sessionDate: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        } as never);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(therapies), this.THERAPY_CACHE_TTL);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic therapies retrieved successfully',
        'AyurvedicTherapyService',
        {
          clinicId,
          count: therapies.length,
          responseTime: Date.now() - startTime,
        }
      );

      return therapies;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic therapies: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get therapies by type
   */
  async getTherapiesByType(
    clinicId: string,
    therapyType: TherapyType
  ): Promise<AyurvedicTherapy[]> {
    const startTime = Date.now();
    const cacheKey = `therapies:clinic:${clinicId}:type:${therapyType}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Use executeHealthcareRead for optimized query
      const therapies = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            ayurvedicTherapy: {
              findMany: <T>(args: T) => Promise<AyurvedicTherapy[]>;
            };
          }
        ).ayurvedicTherapy.findMany({
          where: {
            clinicId,
            therapyType,
            isActive: true,
          },
          orderBy: { name: 'asc' },
        } as never);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(therapies), this.THERAPY_CACHE_TTL);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Therapies by type retrieved successfully',
        'AyurvedicTherapyService',
        {
          clinicId,
          therapyType,
          count: therapies.length,
          responseTime: Date.now() - startTime,
        }
      );

      return therapies;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapies by type: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
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

      // Use executeHealthcareRead for optimized query
      const therapy = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            ayurvedicTherapy: {
              findUnique: <T>(args: T) => Promise<AyurvedicTherapy | null>;
            };
          }
        ).ayurvedicTherapy.findUnique({
          where: { id: therapyId },
          include: {
            sessions: {
              orderBy: { sessionDate: 'desc' },
              take: 20,
            },
          },
        } as never);
      });

      if (!therapy) {
        throw new NotFoundException(`Therapy with ID ${therapyId} not found`);
      }

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(therapy), this.THERAPY_CACHE_TTL);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Therapy retrieved successfully',
        'AyurvedicTherapyService',
        {
          therapyId,
          responseTime: Date.now() - startTime,
        }
      );

      return therapy;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapy: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Update therapy
   */
  async updateTherapy(therapyId: string, data: UpdateTherapyDto): Promise<AyurvedicTherapy> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareWrite for update with audit logging
      const therapy = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              ayurvedicTherapy: {
                update: <T>(args: T) => Promise<AyurvedicTherapy>;
              };
            }
          ).ayurvedicTherapy.update({
            where: { id: therapyId },
            data,
          } as never);
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'AYURVEDIC_THERAPY',
          operation: 'UPDATE',
          resourceId: therapyId,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`therapy:${therapyId}`);
      await this.cacheService.invalidateCacheByTag(`clinic:${therapy.clinicId}`);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Therapy updated successfully',
        'AyurvedicTherapyService',
        {
          therapyId,
          responseTime: Date.now() - startTime,
        }
      );

      return therapy;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update therapy: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        }
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
      // Use executeHealthcareRead first to get record for cache invalidation
      const therapy = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            ayurvedicTherapy: {
              findUnique: <T>(args: T) => Promise<AyurvedicTherapy | null>;
            };
          }
        ).ayurvedicTherapy.findUnique({
          where: { id: therapyId },
        } as never);
      });

      if (!therapy) {
        throw new NotFoundException(`Therapy with ID ${therapyId} not found`);
      }

      // Use executeHealthcareWrite for delete with audit logging
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              ayurvedicTherapy: {
                delete: <T>(args: T) => Promise<AyurvedicTherapy>;
              };
            }
          ).ayurvedicTherapy.delete({
            where: { id: therapyId },
          } as never);
        },
        {
          userId: 'system',
          clinicId: therapy.clinicId || '',
          resourceType: 'AYURVEDIC_THERAPY',
          operation: 'DELETE',
          resourceId: therapyId,
          userRole: 'system',
          details: { name: therapy.name, clinicId: therapy.clinicId },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCache(`therapy:${therapyId}`);
      await this.cacheService.invalidateCacheByTag(`clinic:${therapy.clinicId}`);

      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Therapy deleted successfully',
        'AyurvedicTherapyService',
        {
          therapyId,
          responseTime: Date.now() - startTime,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete therapy: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        }
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
  async createTherapySession(data: CreateTherapySessionDto): Promise<TherapySession> {
    const startTime = Date.now();

    try {
      // Validate therapy exists using executeHealthcareRead
      const therapy = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            ayurvedicTherapy: {
              findUnique: <T>(args: T) => Promise<AyurvedicTherapy | null>;
            };
          }
        ).ayurvedicTherapy.findUnique({
          where: { id: data.therapyId },
        } as never);
      });

      if (!therapy) {
        throw new NotFoundException(`Therapy with ID ${data.therapyId} not found`);
      }

      // Use executeHealthcareWrite for create with audit logging
      const session = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              therapySession: {
                create: <T>(args: T) => Promise<TherapySession>;
              };
            }
          ).therapySession.create({
            data: {
              therapyId: data.therapyId,
              appointmentId: data.appointmentId,
              patientId: data.patientId,
              doctorId: data.doctorId,
              clinicId: data.clinicId,
              sessionDate: data.sessionDate,
              startTime: data.startTime,
              notes: data.notes,
              observations: data.observations as never,
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
          } as never);
        },
        {
          userId: data.patientId,
          clinicId: data.clinicId,
          resourceType: 'THERAPY_SESSION',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'patient',
          details: { therapyId: data.therapyId, appointmentId: data.appointmentId },
        }
      );

      // Invalidate cache using proper method
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);
      await this.cacheService.invalidateCacheByTag(`patient:${data.patientId}`);

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Therapy session created successfully',
        'AyurvedicTherapyService',
        {
          sessionId: session.id,
          therapyId: data.therapyId,
          patientId: data.patientId,
          responseTime: Date.now() - startTime,
        }
      );

      return session;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create therapy session: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get therapy sessions for a patient
   */
  async getPatientTherapySessions(patientId: string, clinicId: string): Promise<TherapySession[]> {
    const startTime = Date.now();
    const cacheKey = `therapy-sessions:patient:${patientId}:clinic:${clinicId}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Use executeHealthcareRead for optimized query
      const sessions = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            therapySession: {
              findMany: <T>(args: T) => Promise<TherapySession[]>;
            };
          }
        ).therapySession.findMany({
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
          orderBy: { sessionDate: 'desc' },
        } as never);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(sessions), this.SESSION_CACHE_TTL);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient therapy sessions retrieved successfully',
        'AyurvedicTherapyService',
        {
          patientId,
          clinicId,
          count: sessions.length,
          responseTime: Date.now() - startTime,
        }
      );

      return sessions;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient therapy sessions: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          patientId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
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
    date?: Date
  ): Promise<TherapySession[]> {
    const startTime = Date.now();
    const dateStr = date ? date.toISOString().split('T')[0] : 'all';
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

      // Use executeHealthcareRead for optimized query
      const sessions = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            therapySession: {
              findMany: <T>(args: T) => Promise<TherapySession[]>;
            };
          }
        ).therapySession.findMany({
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
          orderBy: { sessionDate: 'asc' },
        } as never);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(sessions), this.SESSION_CACHE_TTL);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor therapy sessions retrieved successfully',
        'AyurvedicTherapyService',
        {
          doctorId,
          clinicId,
          date: dateStr,
          count: sessions.length,
          responseTime: Date.now() - startTime,
        }
      );

      return sessions;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor therapy sessions: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          doctorId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Update therapy session
   */
  async updateTherapySession(
    sessionId: string,
    data: UpdateTherapySessionDto
  ): Promise<TherapySession> {
    const startTime = Date.now();

    try {
      // Use executeHealthcareWrite for update with audit logging
      const session = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await (
            client as unknown as {
              therapySession: {
                update: <T>(args: T) => Promise<TherapySession>;
              };
            }
          ).therapySession.update({
            where: { id: sessionId },
            data: {
              ...data,
              observations: data.observations as never,
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
          } as never);
        },
        {
          userId: 'system',
          clinicId: '',
          resourceType: 'THERAPY_SESSION',
          operation: 'UPDATE',
          resourceId: sessionId,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      // Invalidate cache using proper method
      const sessionWithIds = session as TherapySession & {
        clinicId?: string;
        patientId?: string;
        doctorId?: string;
      };
      if (sessionWithIds.clinicId) {
        await this.cacheService.invalidateCacheByTag(`clinic:${sessionWithIds.clinicId}`);
      }
      if (sessionWithIds.patientId) {
        await this.cacheService.invalidateCacheByTag(`patient:${sessionWithIds.patientId}`);
      }
      if (sessionWithIds.doctorId) {
        await this.cacheService.invalidateCacheByTag(`doctor:${sessionWithIds.doctorId}`);
      }

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Therapy session updated successfully',
        'AyurvedicTherapyService',
        {
          sessionId,
          status: data.status,
          responseTime: Date.now() - startTime,
        }
      );

      return session;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update therapy session: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          sessionId,
          error: error instanceof Error ? error.stack : undefined,
        }
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
    nextSessionDate?: Date
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
  async cancelTherapySession(sessionId: string, notes?: string): Promise<TherapySession> {
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
    therapyId?: string
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

      // Use executeHealthcareRead for optimized query
      const sessions = await this.databaseService.executeHealthcareRead(async client => {
        return await (
          client as unknown as {
            therapySession: {
              findMany: <T>(args: T) => Promise<TherapySession[]>;
            };
          }
        ).therapySession.findMany({
          where: whereClause,
          select: {
            status: true,
            startTime: true,
            endTime: true,
          },
        } as never);
      });

      type SessionWithStatus = { status: TherapyStatus };
      const sessionsTyped = sessions as SessionWithStatus[];
      const stats = {
        total: sessions.length,
        scheduled: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.SCHEDULED
        ).length,
        inProgress: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.IN_PROGRESS
        ).length,
        completed: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.COMPLETED
        ).length,
        cancelled: sessionsTyped.filter(
          (s: SessionWithStatus) => s.status === TherapyStatus.CANCELLED
        ).length,
        averageDuration: 0,
      };

      // Calculate average duration for completed sessions
      type SessionWithTimes = TherapySession & {
        status: TherapyStatus;
        endTime: Date;
        startTime: Date;
      };
      const completedSessions = sessions.filter(
        (s): s is SessionWithTimes =>
          s.status === TherapyStatus.COMPLETED && !!s.endTime && !!s.startTime
      );

      if (completedSessions.length > 0) {
        const totalDuration = completedSessions.reduce((sum: number, session: SessionWithTimes) => {
          if (!session.endTime || !session.startTime) return sum;
          const duration =
            (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000; // minutes
          return sum + duration;
        }, 0);
        stats.averageDuration = Math.round(totalDuration / completedSessions.length);
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Therapy session stats retrieved successfully',
        'AyurvedicTherapyService',
        {
          clinicId,
          therapyId,
          stats,
          responseTime: Date.now() - startTime,
        }
      );

      return stats;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get therapy session stats: ${error instanceof Error ? error.message : String(error)}`,
        'AyurvedicTherapyService',
        {
          clinicId,
          therapyId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }
}
