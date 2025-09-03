import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClinicIsolationService } from '../clinic-isolation.service';
export interface RepositoryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PatientWithUser {
  id: string;
  userId: string;
  prakriti: string | null;
  dosha: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    dateOfBirth?: Date;
    gender?: string;
    address?: string;
    emergencyContact?: string;
    isVerified: boolean;
  };
  appointments?: any[];
  healthRecords?: any[];
}

/**
 * Simple Patient Repository for clinic-specific operations
 * Works with the actual Patient model that references User
 */
@Injectable()
export class SimplePatientRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clinicIsolationService: ClinicIsolationService,
  ) {}

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
  ): Promise<RepositoryResult<{ data: PatientWithUser[]; total: number; page: number; totalPages: number }>> {
    return this.clinicIsolationService.executeWithClinicContext(clinicId, async () => {
      const { page = 1, limit = 20, includeAppointments = false, includeHealthRecords = false } = options;
      const skip = (page - 1) * limit;

      // Find patients who have appointments in this clinic
      const whereClause = {
        appointments: {
          some: {
            clinicId: clinicId
          }
        }
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
          }
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
              type: true
            }
          }
        }),
        ...(includeHealthRecords && {
          healthRecords: {
            orderBy: { createdAt: 'desc' as const },
            take: 5
          }
        })
      };

      const [data, total] = await Promise.all([
        this.prisma.patient.findMany({
          where: whereClause,
          include,
          orderBy: { createdAt: 'desc' as const },
          skip,
          take: limit,
        }),
        this.prisma.patient.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        data: data as PatientWithUser[],
        total,
        page,
        totalPages
      };
    });
  }

  /**
   * Get a specific patient by ID for a clinic
   */
  async getPatientById(
    patientId: string,
    clinicId: string
  ): Promise<RepositoryResult<PatientWithUser | null>> {
    return this.clinicIsolationService.executeWithClinicContext(clinicId, async () => {
      const patient = await this.prisma.patient.findFirst({
        where: {
          id: patientId,
          appointments: {
            some: {
              clinicId: clinicId
            }
          }
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
            }
          },
          appointments: {
            where: { clinicId },
            orderBy: { date: 'desc' as const },
            select: {
              id: true,
              date: true,
              time: true,
              status: true,
              type: true,
              doctor: {
                select: {
                  id: true,
                  user: {
                    select: {
                      name: true,
                      firstName: true,
                      lastName: true
                    }
                  }
                }
              }
            }
          },
          healthRecords: {
            orderBy: { createdAt: 'desc' as const },
            take: 10
          }
        }
      });

      return patient as PatientWithUser | null;
    });
  }

  /**
   * Search patients by name or contact info within a clinic
   */
  async searchPatients(
    query: string,
    clinicId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<RepositoryResult<{ data: PatientWithUser[]; total: number; page: number; totalPages: number }>> {
    return this.clinicIsolationService.executeWithClinicContext(clinicId, async () => {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const whereClause = {
        appointments: {
          some: {
            clinicId: clinicId
          }
        },
        user: {
          OR: [
            {
              name: {
                contains: query,
                mode: 'insensitive' as const
              }
            },
            {
              firstName: {
                contains: query,
                mode: 'insensitive' as const
              }
            },
            {
              lastName: {
                contains: query,
                mode: 'insensitive' as const
              }
            },
            {
              email: {
                contains: query,
                mode: 'insensitive' as const
              }
            },
            {
              phone: {
                contains: query,
                mode: 'insensitive' as const
              }
            }
          ]
        }
      };

      const [data, total] = await Promise.all([
        this.prisma.patient.findMany({
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
              }
            }
          },
          orderBy: { createdAt: 'desc' as const },
          skip,
          take: limit,
        }),
        this.prisma.patient.count({ where: whereClause })
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        data: data as PatientWithUser[],
        total,
        page,
        totalPages
      };
    });
  }

  /**
   * Get patient statistics for a clinic
   */
  async getPatientStatistics(
    clinicId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<RepositoryResult<{
    totalPatients: number;
    newPatients: number;
    patientsWithRecentAppointments: number;
  }>> {
    return this.clinicIsolationService.executeWithClinicContext(clinicId, async () => {
      const baseAppointmentWhere = {
        clinicId,
        ...(dateRange && {
          date: {
            gte: dateRange.from,
            lte: dateRange.to
          }
        })
      };

      const [
        totalPatients,
        newPatients,
        patientsWithRecentAppointments
      ] = await Promise.all([
        // Total patients who have appointments in this clinic
        this.prisma.patient.count({
          where: {
            appointments: {
              some: { clinicId }
            }
          }
        }),
        
        // New patients (created in date range) with appointments in clinic
        this.prisma.patient.count({
          where: {
            appointments: {
              some: { clinicId }
            },
            ...(dateRange && {
              createdAt: {
                gte: dateRange.from,
                lte: dateRange.to
              }
            })
          }
        }),
        
        // Patients with recent appointments
        this.prisma.patient.count({
          where: {
            appointments: {
              some: baseAppointmentWhere
            }
          }
        })
      ]);

      return {
        totalPatients,
        newPatients,
        patientsWithRecentAppointments
      };
    });
  }
}