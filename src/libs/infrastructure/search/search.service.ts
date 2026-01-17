/**
 * Search Service
 * ==============
 * High-level search service for patients, appointments, and medical records
 * Uses database queries for full-text search
 *
 * @module SearchService
 * @description Unified search interface using database queries
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@database/database.service';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { LogType, LogLevel } from '@core/types';

/**
 * Search Result
 */
export interface SearchResult<T = unknown> {
  hits: Array<{
    id: string;
    score: number;
    source: T;
  }>;
  total: number;
  took: number;
}

/**
 * Search Service
 * Provides search capabilities across different entity types using database queries
 */
@Injectable()
export class SearchService {
  private readonly SEARCH_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Search patients with caching
   */
  async searchPatients(
    query: string,
    clinicId?: string,
    limit = 20
  ): Promise<SearchResult<{ id: string; name: string; email: string; phone?: string }>> {
    const startTime = Date.now();
    const cacheKey = `search:patients:${clinicId || 'all'}:${query}:${limit}`;

    try {
      // Try cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as SearchResult<{
          id: string;
          name: string;
          email: string;
          phone?: string;
        }>;
      }

      const result = await this.searchPatientsInDatabase(query, clinicId, limit);

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.SEARCH_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Patient search completed`,
        'SearchService.searchPatients',
        {
          query,
          clinicId,
          resultCount: result.total,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Patient search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SearchService.searchPatients',
        {
          error: error instanceof Error ? error.message : String(error),
          query,
          clinicId,
        }
      );
      throw error;
    }
  }

  /**
   * Search appointments
   */
  async searchAppointments(
    query: string,
    clinicId?: string,
    limit = 20
  ): Promise<
    SearchResult<{ id: string; patientId: string; doctorId: string; date: Date; status: string }>
  > {
    return await this.searchAppointmentsInDatabase(query, clinicId, limit);
  }

  /**
   * Search medical records
   */
  async searchMedicalRecords(
    query: string,
    patientId?: string,
    clinicId?: string,
    limit = 20
  ): Promise<SearchResult<{ id: string; patientId: string; recordType: string; report?: string }>> {
    return await this.searchMedicalRecordsInDatabase(query, patientId, clinicId, limit);
  }

  /**
   * Search patients in database
   */
  private async searchPatientsInDatabase(
    query: string,
    clinicId?: string,
    limit = 20
  ): Promise<SearchResult<{ id: string; name: string; email: string; phone?: string }>> {
    const users = await this.databaseService.executeHealthcareRead(async client => {
      const userClient = client as unknown as {
        user: {
          findMany: (args: {
            where: unknown;
            select: { id: true; name: true; email: true; phone: true; primaryClinicId: true };
            take: number;
          }) => Promise<
            Array<{
              id: string;
              name: string | null;
              email: string;
              phone: string | null;
              primaryClinicId: string | null;
            }>
          >;
        };
      };
      return await userClient.user.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' as const } },
            { email: { contains: query, mode: 'insensitive' as const } },
            { phone: { contains: query, mode: 'insensitive' as const } },
          ],
          ...(clinicId && { primaryClinicId: clinicId }),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          primaryClinicId: true,
        },
        take: limit,
      });
    });

    return {
      hits: users.map(
        (user: {
          id: string;
          name: string | null;
          email: string;
          phone: string | null;
          primaryClinicId: string | null;
        }) => ({
          id: user.id,
          score: 1,
          source: {
            id: user.id,
            name: user.name ?? '',
            email: user.email,
            ...(user.phone ? { phone: user.phone } : {}),
          },
        })
      ),
      total: users.length,
      took: 0,
    };
  }

  /**
   * Search appointments in database
   */
  private async searchAppointmentsInDatabase(
    query: string,
    clinicId?: string,
    limit = 20
  ): Promise<
    SearchResult<{ id: string; patientId: string; doctorId: string; date: Date; status: string }>
  > {
    const appointments = await this.databaseService.executeHealthcareRead(async client => {
      const appointmentClient = client as unknown as {
        appointment: {
          findMany: (args: {
            where: unknown;
            select: {
              id: true;
              patientId: true;
              doctorId: true;
              date: true;
              status: true;
              clinicId: true;
              notes: true;
            };
            take: number;
          }) => Promise<
            Array<{
              id: string;
              patientId: string;
              doctorId: string | null;
              date: Date;
              status: string;
              clinicId: string;
              notes: string | null;
            }>
          >;
        };
      };
      return await appointmentClient.appointment.findMany({
        where: {
          notes: { contains: query, mode: 'insensitive' as const },
          ...(clinicId && { clinicId }),
        },
        select: {
          id: true,
          patientId: true,
          doctorId: true,
          date: true,
          status: true,
          clinicId: true,
          notes: true,
        },
        take: limit,
      });
    });

    return {
      hits: appointments.map(
        (appointment: {
          id: string;
          patientId: string;
          doctorId: string | null;
          date: Date;
          status: string;
          clinicId: string;
          notes: string | null;
        }) => ({
          id: appointment.id,
          score: 1,
          source: {
            id: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId ?? '',
            date: appointment.date,
            status: appointment.status,
          },
        })
      ),
      total: appointments.length,
      took: 0,
    };
  }

  /**
   * Search medical records in database
   */
  private async searchMedicalRecordsInDatabase(
    query: string,
    patientId?: string,
    clinicId?: string,
    limit = 20
  ): Promise<SearchResult<{ id: string; patientId: string; recordType: string; report?: string }>> {
    const records = await this.databaseService.executeHealthcareRead(async client => {
      const healthRecordClient = client as unknown as {
        healthRecord: {
          findMany: (args: {
            where: unknown;
            select: { id: true; patientId: true; recordType: true; report: true; clinicId: true };
            take: number;
          }) => Promise<
            Array<{
              id: string;
              patientId: string;
              recordType: string;
              report: string | null;
              clinicId: string;
            }>
          >;
        };
      };
      return await healthRecordClient.healthRecord.findMany({
        where: {
          report: { contains: query, mode: 'insensitive' as const },
          ...(patientId && { patientId }),
          ...(clinicId && { clinicId }),
        },
        select: {
          id: true,
          patientId: true,
          recordType: true,
          report: true,
          clinicId: true,
        },
        take: limit,
      });
    });

    return {
      hits: records.map(
        (record: {
          id: string;
          patientId: string;
          recordType: string;
          report: string | null;
          clinicId: string;
        }) => ({
          id: record.id,
          score: 1,
          source: {
            id: record.id,
            patientId: record.patientId,
            recordType: record.recordType,
            ...(record.report ? { report: record.report } : {}),
          },
        })
      ),
      total: records.length,
      took: 0,
    };
  }
}
