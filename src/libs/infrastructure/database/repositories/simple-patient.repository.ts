import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { ClinicIsolationService } from '@infrastructure/database/internal/clinic-isolation.service';
import { RepositoryResult } from '@core/types/database.types';
import type { PatientWithUser, PatientWithUserOrNull } from '@core/types/database.types';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { PrismaService } from '@infrastructure/database/prisma/prisma.service';

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
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => ClinicIsolationService))
    private readonly clinicIsolationService: ClinicIsolationService,
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
    const result = await this.clinicIsolationService.executeWithClinicContext(
      clinicId,
      async () => {
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

        // Use HealthcareDatabaseClient for optimization layers
        const databaseClient = this.databaseService;
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
          // Get Prisma client through internal accessor
          const prismaClient = (
            databaseClient as unknown as {
              getInternalPrismaClient: () => { patient: PatientDelegate };
            }
          ).getInternalPrismaClient();
          const patientDelegate = prismaClient.patient;

          const [data, totalResult] = await Promise.all([
            databaseClient.executeHealthcareRead(async _client => {
              return await patientDelegate.findMany({
                where: whereClause,
                include,
                orderBy: { createdAt: 'desc' as const },
                skip,
                take: limit,
              } as never);
            }),
            databaseClient.executeHealthcareRead(async _client => {
              return await patientDelegate.count({ where: whereClause } as never);
            }),
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

        return {
          data: safeData,
          total: safeTotal,
          page,
          totalPages,
        };
      }
    );

    // Convert ClinicIsolationResult to RepositoryResult
    if (result.success && result.data) {
      const data = result.data;
      // Ensure data and total are not null
      if (data.data && data.total !== null && data.total !== undefined) {
        return RepositoryResult.success({
          data: data.data,
          total: data.total,
          page: data.page,
          totalPages: data.totalPages,
        });
      } else {
        return RepositoryResult.failure(new Error('Invalid data returned from clinic operation'));
      }
    } else {
      return RepositoryResult.failure(
        new Error(result.error || 'Failed to get patients for clinic')
      );
    }
  }

  /**
   * Get a specific patient by ID for a clinic
   */
  async getPatientById(
    patientId: string,
    clinicId: string
  ): Promise<RepositoryResult<PatientWithUserOrNull>> {
    const result = await this.clinicIsolationService.executeWithClinicContext(
      clinicId,
      async (): Promise<PatientWithUserOrNull> => {
        // Use HealthcareDatabaseClient for optimization layers
        const databaseClient = this.databaseService;
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
          // Get Prisma client through internal accessor
          const prismaClient = (
            databaseClient as unknown as {
              getInternalPrismaClient: () => { patient: PatientDelegate };
            }
          ).getInternalPrismaClient();
          const patientDelegate = prismaClient.patient;
          patient = (await databaseClient.executeHealthcareRead(async _client => {
            return await patientDelegate.findFirst({
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
            } as never);
          })) as PatientWithUserOrNull;

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

        return patient;
      }
    );

    // Convert ClinicIsolationResult to RepositoryResult
    if (result.success) {
      if (result.data === null || result.data === undefined) {
        return RepositoryResult.success(null as PatientWithUserOrNull);
      }
      const resultData = result.data as unknown as PatientWithUserOrNull;
      return RepositoryResult.success(resultData);
    } else {
      return RepositoryResult.failure(new Error(result.error || 'Failed to get patient by ID'));
    }
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
    const result = await this.clinicIsolationService.executeWithClinicContext(
      clinicId,
      async () => {
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

        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type PatientDelegate = {
          findMany: <T>(args: T) => Promise<unknown>;
          count: <T>(args: T) => Promise<number>;
        };
        const patientDelegate = (prismaClient as unknown as { patient: PatientDelegate }).patient;
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

        return {
          data: typedData,
          total,
          page,
          totalPages,
        };
      }
    );

    // Convert ClinicIsolationResult to RepositoryResult
    if (result.success && result.data) {
      return RepositoryResult.success(result.data);
    } else {
      return RepositoryResult.failure(new Error(result.error || 'Failed to search patients'));
    }
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
    const result = await this.clinicIsolationService.executeWithClinicContext(
      clinicId,
      async () => {
        const baseAppointmentWhere = {
          clinicId,
          ...(dateRange && {
            date: {
              gte: dateRange.from,
              lte: dateRange.to,
            },
          }),
        };

        const prismaClient = (
          this.databaseService as unknown as { getInternalPrismaClient: () => PrismaService }
        ).getInternalPrismaClient();
        type PatientDelegate = {
          count: <T>(args: T) => Promise<number>;
        };
        const patientDelegate = (prismaClient as unknown as { patient: PatientDelegate }).patient;
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

        return {
          totalPatients,
          newPatients,
          patientsWithRecentAppointments,
        };
      }
    );

    // Convert ClinicIsolationResult to RepositoryResult
    if (result.success && result.data) {
      return RepositoryResult.success(result.data);
    } else {
      return RepositoryResult.failure(
        new Error(result.error || 'Failed to get patient statistics')
      );
    }
  }
}
