import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '@database/prisma/prisma.service';
import { RepositoryResult } from '@core/types/database.types';
import type { PatientWithUser, PatientWithUserOrNull } from '@core/types/database.types';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * Simple Patient Repository - INTERNAL INFRASTRUCTURE COMPONENT
 *
 * NOT FOR DIRECT USE - Use DatabaseService instead.
 * This repository is an internal component used by DatabaseService optimization layers.
 * Works with the actual Patient model that references User.
 * @internal
 */
@Injectable()
export class SimplePatientRepository {
  constructor(
    @Inject(forwardRef(() => PrismaService))
    private readonly prismaService: PrismaService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  /**
   * Generate cache key for patient operations
   */
  private getCacheKey(operation: string, ...parts: Array<string | number | undefined>): string {
    const filteredParts = parts.filter(p => p !== undefined && p !== null);
    return `patient:${operation}:${filteredParts.join(':')}`;
  }

  /**
   * Get patients for a specific clinic
   */
  async getPatientsForClinic(
    clinicId: string,
    options: {
      page?: number;
      limit?: number;
      includeAppointments?: boolean;
      includeHealthRecords?: boolean;
    } = {}
  ): Promise<
    RepositoryResult<{
      data: PatientWithUser[];
      total: number;
      page: number;
      totalPages: number;
    }>
  > {
    // Use PrismaService directly - clinic isolation will be handled by DatabaseService
    const {
      page = 1,
      limit = 20,
      includeAppointments = false,
      includeHealthRecords = false,
    } = options;
    const skip = (page - 1) * limit;

    // Find patients who have appointments in this clinic
    const whereClause = {
      appointments: {
        some: {
          clinicId: clinicId,
        },
      },
    };

    const include = {
      user: {
        select: {
          id: true,
          name: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          dateOfBirth: true,
          gender: true,
          address: true,
          emergencyContact: true,
          isVerified: true,
        },
      },
      ...(includeAppointments && {
        appointments: {
          where: { clinicId },
          orderBy: { date: 'desc' as const },
          take: 5,
          select: {
            id: true,
            date: true,
            time: true,
            status: true,
            type: true,
          },
        },
      }),
      ...(includeHealthRecords && {
        healthRecords: {
          orderBy: { createdAt: 'desc' as const },
          take: 5,
        },
      }),
    };

    type PatientDelegate = {
      findMany: <T>(args: T) => Promise<unknown>;
      count: <T>(args: T) => Promise<number>;
    };

    // Try cache first if enabled
    const cacheKey = this.getCacheKey(
      'clinic',
      clinicId,
      'page',
      page,
      'limit',
      limit,
      String(includeAppointments),
      String(includeHealthRecords)
    );
    let typedData: PatientWithUser[] | null = null;
    let total: number | null = null;
    let cacheHit = false;

    if (this.cacheService) {
      try {
        const cached = await this.cacheService.get<{ data: PatientWithUser[]; total: number }>(
          cacheKey
        );
        if (cached) {
          typedData = cached.data;
          total = cached.total;
          cacheHit = true;
        }
      } catch (cacheError) {
        void this.loggingService?.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cache lookup failed, falling back to database: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          'SimplePatientRepository'
        );
      }
    }

    if (!cacheHit) {
      // Use PrismaService directly
      const patientDelegate = this.prismaService.patient as PatientDelegate;

      const [data, totalResult] = await Promise.all([
        patientDelegate.findMany({
          where: whereClause,
          include,
          orderBy: { createdAt: 'desc' as const },
          skip,
          take: limit,
        } as never),
        patientDelegate.count({ where: whereClause } as never),
      ]);

      typedData = data as PatientWithUser[];
      total = totalResult;

      // Cache the result
      if (this.cacheService) {
        await this.cacheService
          .set(
            cacheKey,
            { data: typedData, total },
            3600 // 1 hour TTL
          )
          .catch(() => {
            // Cache write failed - non-critical
          });
      }
    }

    // Ensure typedData and total are not null before using
    const safeTotal = total ?? 0;
    const safeData = typedData ?? [];
    const totalPages = Math.ceil(safeTotal / limit);

    return RepositoryResult.success({
      data: safeData,
      total: safeTotal,
      page,
      totalPages,
    });
  }

  /**
   * Get a specific patient by ID for a clinic
   */
  async getPatientById(
    patientId: string,
    clinicId: string
  ): Promise<RepositoryResult<PatientWithUserOrNull>> {
    // Use PrismaService directly - clinic isolation will be handled by DatabaseService
    type PatientDelegate = {
      findFirst: <T>(args: T) => Promise<unknown>;
    };

    // Try cache first if enabled
    const cacheKey = this.getCacheKey('id', patientId, 'clinic', clinicId);
    let patient: PatientWithUserOrNull | null = null;
    let cacheHit = false;

    if (this.cacheService) {
      try {
        patient = await this.cacheService.get<PatientWithUserOrNull>(cacheKey);
        if (patient !== null) {
          cacheHit = true;
        }
      } catch (cacheError) {
        void this.loggingService?.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Cache lookup failed, falling back to database: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`,
          'SimplePatientRepository'
        );
      }
    }

    if (!cacheHit) {
      // Use PrismaService directly
      const patientDelegate = this.prismaService.patient as PatientDelegate;
      patient = (await patientDelegate.findFirst({
        where: {
          id: patientId,
          appointments: {
            some: {
              clinicId: clinicId,
            },
          },
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              dateOfBirth: true,
              gender: true,
              address: true,
              emergencyContact: true,
              isVerified: true,
            },
          },
        },
      } as never)) as PatientWithUserOrNull;

      // Cache the result
      if (this.cacheService && patient) {
        await this.cacheService
          .set(
            cacheKey,
            patient,
            3600 // 1 hour TTL
          )
          .catch(() => {
            // Cache write failed - non-critical
          });
      }
    }

    return RepositoryResult.success(patient);
  }

  /**
   * Search patients by name or contact info within a clinic
   */
  async searchPatients(
    query: string,
    clinicId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<
    RepositoryResult<{
      data: PatientWithUser[];
      total: number;
      page: number;
      totalPages: number;
    }>
  > {
    // Use PrismaService directly - clinic isolation will be handled by DatabaseService
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const whereClause = {
      appointments: {
        some: {
          clinicId: clinicId,
        },
      },
      user: {
        OR: [
          {
            name: {
              contains: query,
              mode: 'insensitive' as const,
            },
          },
          {
            firstName: {
              contains: query,
              mode: 'insensitive' as const,
            },
          },
          {
            lastName: {
              contains: query,
              mode: 'insensitive' as const,
            },
          },
          {
            email: {
              contains: query,
              mode: 'insensitive' as const,
            },
          },
          {
            phone: {
              contains: query,
              mode: 'insensitive' as const,
            },
          },
        ],
      },
    };

    type PatientDelegate = {
      findMany: <T>(args: T) => Promise<unknown>;
      count: <T>(args: T) => Promise<number>;
    };
    const patientDelegate = this.prismaService.patient as PatientDelegate;
    const [data, total] = await Promise.all([
      patientDelegate.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              dateOfBirth: true,
              gender: true,
              address: true,
              emergencyContact: true,
              isVerified: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' as const },
        skip,
        take: limit,
      } as never),
      patientDelegate.count({ where: whereClause } as never),
    ]);
    const typedData = data as PatientWithUser[];

    const totalPages = Math.ceil(total / limit);

    return RepositoryResult.success({
      data: typedData,
      total,
      page,
      totalPages,
    });
  }

  /**
   * Get patient statistics for a clinic
   */
  async getPatientStatistics(
    clinicId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<
    RepositoryResult<{
      totalPatients: number;
      newPatients: number;
      patientsWithRecentAppointments: number;
    }>
  > {
    // Use PrismaService directly - clinic isolation will be handled by DatabaseService
    const baseAppointmentWhere = {
      clinicId,
      ...(dateRange && {
        date: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      }),
    };

    type PatientDelegate = {
      count: <T>(args: T) => Promise<number>;
    };
    const patientDelegate = this.prismaService.patient as PatientDelegate;
    const [totalPatients, newPatients, patientsWithRecentAppointments] = await Promise.all([
      // Total patients who have appointments in this clinic
      patientDelegate.count({
        where: {
          appointments: {
            some: { clinicId },
          },
        },
      } as never),

      // New patients (created in date range) with appointments in clinic
      patientDelegate.count({
        where: {
          appointments: {
            some: { clinicId },
          },
          ...(dateRange && {
            createdAt: {
              gte: dateRange.from,
              lte: dateRange.to,
            },
          }),
        },
      } as never),

      // Patients with recent appointments
      patientDelegate.count({
        where: {
          appointments: {
            some: baseAppointmentWhere,
          },
        },
      } as never),
    ]);

    return RepositoryResult.success({
      totalPatients,
      newPatients,
      patientsWithRecentAppointments,
    });
  }
}
