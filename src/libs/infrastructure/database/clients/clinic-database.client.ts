import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { HealthcareDatabaseClient } from './healthcare-database.client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionPoolManager } from '../connection-pool.manager';
import { DatabaseMetricsService } from '../database-metrics.service';
import { ClinicIsolationService } from '../clinic-isolation.service';
import { RepositoryResult, ClinicError } from '../types/repository-result';
import {
  IClinicDatabaseClient,
  ClinicDatabaseMetrics,
  HealthcareDatabaseConfig,
} from '../interfaces/database-client.interface';

/**
 * Clinic-Specific Database Client
 * 
 * Provides clinic-isolated database operations with:
 * - Complete data isolation between clinics
 * - Clinic-specific metrics and monitoring
 * - Multi-location support within clinic
 * - Automatic clinic context management
 * - Scalable for 10L+ users across multiple clinics
 */
export class ClinicDatabaseClient extends HealthcareDatabaseClient implements IClinicDatabaseClient {
  protected readonly logger = new Logger(ClinicDatabaseClient.name);
  
  constructor(
    prismaService: PrismaService,
    connectionPoolManager: ConnectionPoolManager,
    metricsService: DatabaseMetricsService,
    healthcareConfig: HealthcareDatabaseConfig,
    private readonly clinicIsolationService: ClinicIsolationService,
    private readonly clinicId: string,
  ) {
    super(prismaService, connectionPoolManager, metricsService, healthcareConfig);
    this.logger.log(`Clinic database client initialized for clinic: ${clinicId}`);
  }

  /**
   * Get the clinic ID this client is associated with
   */
  getClinicId(): string {
    return this.clinicId;
  }

  /**
   * Execute operation with clinic isolation context
   */
  async executeWithClinicContext<T>(
    operation: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await this.clinicIsolationService.executeWithClinicContext(
        this.clinicId,
        async () => {
          return this.executeHealthcareRead(operation);
        }
      );
      
      if (!result.success) {
        throw new ClinicError(
          `Clinic operation failed: ${result.error}`,
          'CLINIC_CONTEXT_ERROR',
          this.clinicId,
          { originalError: result.error }
        );
      }
      
      const executionTime = Date.now() - startTime;
      this.logger.debug(`Clinic operation completed for ${this.clinicId} in ${executionTime}ms`);
      
      return result.data!;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error(`Clinic operation failed for ${this.clinicId}:`, {
        clinicId: this.clinicId,
        executionTime,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Get clinic-specific metrics
   */
  async getClinicMetrics(): Promise<ClinicDatabaseMetrics> {
    const baseMetrics = await this.getMetrics();
    const clinicMetrics = this.metricsService.getClinicMetrics(this.clinicId);
    
    // Get clinic info
    const clinicResult = await this.clinicIsolationService.getClinicContext(this.clinicId);
    const clinicName = clinicResult.success ? clinicResult.data!.clinicName : 'Unknown';
    
    return {
      ...baseMetrics,
      clinicId: this.clinicId,
      clinicName,
      patientCount: clinicMetrics?.patientCount || 0,
      appointmentCount: clinicMetrics?.appointmentCount || 0,
      staffCount: await this.getStaffCount(),
      locationCount: await this.getLocationCount(),
    };
  }

  /**
   * Execute patient operation within clinic context
   */
  async executeClinicPatientOperation<T>(
    patientId: string,
    userId: string,
    operation: (client: PrismaClient) => Promise<T>,
    operationType: 'READ' | 'write' | 'delete'
  ): Promise<RepositoryResult<T>> {
    // Validate patient belongs to clinic
    const patientValidation = await this.validatePatientBelongsToClinic(patientId);
    if (!patientValidation.isSuccess) {
      return RepositoryResult.failure(
        new ClinicError(
          'Patient does not belong to this clinic',
          'PATIENT_CLINIC_MISMATCH',
          this.clinicId,
          { patientId }
        )
      );
    }
    
    return this.executePatientOperation(
      patientId,
      this.clinicId,
      userId,
      operation,
      operationType
    );
  }

  /**
   * Execute appointment operation within clinic context
   */
  async executeClinicAppointmentOperation<T>(
    appointmentId: string,
    locationId: string,
    userId: string,
    operation: (client: PrismaClient) => Promise<T>,
    operationType: 'create' | 'update' | 'cancel'
  ): Promise<RepositoryResult<T>> {
    // Validate location belongs to clinic
    const locationValidation = await this.validateLocationBelongsToClinic(locationId);
    if (!locationValidation.isSuccess) {
      return RepositoryResult.failure(
        new ClinicError(
          'Location does not belong to this clinic',
          'LOCATION_CLINIC_MISMATCH',
          this.clinicId,
          { locationId }
        )
      );
    }
    
    return this.executeAppointmentOperation(
      appointmentId,
      this.clinicId,
      userId,
      operation,
      operationType
    );
  }

  /**
   * Get clinic patients with pagination and filtering
   */
  async getClinicPatients(
    options: {
      page?: number;
      limit?: number;
      locationId?: string;
      searchTerm?: string;
      includeInactive?: boolean;
    } = {}
  ): Promise<RepositoryResult<{
    patients: any[];
    total: number;
    page: number;
    totalPages: number;
  }>> {
    const { page = 1, limit = 20, locationId, searchTerm, includeInactive = false } = options;
    
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(async (client) => {
          const whereClause: any = {
            appointments: {
              some: {
                clinicId: this.clinicId,
                ...(locationId ? { locationId } : {})
              }
            }
          };
          
          // Add search filter
          if (searchTerm) {
            whereClause.user = {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { firstName: { contains: searchTerm, mode: 'insensitive' } },
                { lastName: { contains: searchTerm, mode: 'insensitive' } },
                { email: { contains: searchTerm, mode: 'insensitive' } },
                { phone: { contains: searchTerm, mode: 'insensitive' } }
              ]
            };
          }
          
          const skip = (page - 1) * limit;
          
          const [patients, total] = await Promise.all([
            client.patient.findMany({
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
                    isVerified: true,
                  }
                },
                appointments: {
                  where: { clinicId: this.clinicId },
                  orderBy: { date: 'desc' },
                  take: 3,
                  select: {
                    id: true,
                    date: true,
                    time: true,
                    status: true,
                    type: true
                  }
                }
              },
              orderBy: { createdAt: 'desc' },
              skip,
              take: limit,
            }),
            client.patient.count({ where: whereClause })
          ]);
          
          const totalPages = Math.ceil(total / limit);
          
          return {
            patients,
            total,
            page,
            totalPages
          };
        });
      },
      'GET_CLINIC_PATIENTS',
      this.clinicId
    );
  }

  /**
   * Get clinic appointments with advanced filtering
   */
  async getClinicAppointments(
    options: {
      page?: number;
      limit?: number;
      locationId?: string;
      dateFrom?: Date;
      dateTo?: Date;
      status?: string;
      doctorId?: string;
    } = {}
  ): Promise<RepositoryResult<{
    appointments: any[];
    total: number;
    page: number;
    totalPages: number;
  }>> {
    const { page = 1, limit = 50, locationId, dateFrom, dateTo, status, doctorId } = options;
    
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(async (client) => {
          const whereClause: any = {
            clinicId: this.clinicId,
            ...(locationId ? { locationId } : {}),
            ...(doctorId ? { doctorId } : {}),
            ...(status ? { status } : {}),
            ...(dateFrom || dateTo ? {
              date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {})
              }
            } : {})
          };
          
          const skip = (page - 1) * limit;
          
          const [appointments, total] = await Promise.all([
            client.appointment.findMany({
              where: whereClause,
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        email: true
                      }
                    }
                  }
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        firstName: true,
                        lastName: true
                      }
                    }
                  }
                },
                location: {
                  select: {
                    id: true,
                    name: true,
                    address: true
                  }
                }
              },
              orderBy: { date: 'asc' },
              skip,
              take: limit,
            }),
            client.appointment.count({ where: whereClause })
          ]);
          
          const totalPages = Math.ceil(total / limit);
          
          return {
            appointments,
            total,
            page,
            totalPages
          };
        });
      },
      'GET_CLINIC_APPOINTMENTS',
      this.clinicId
    );
  }

  /**
   * Get clinic dashboard statistics
   */
  async getClinicDashboardStats(): Promise<RepositoryResult<{
    totalPatients: number;
    totalAppointments: number;
    todayAppointments: number;
    upcomingAppointments: number;
    totalDoctors: number;
    totalLocations: number;
    recentActivity: any[];
  }>> {
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(async (client) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          const [
            totalPatients,
            totalAppointments,
            todayAppointments,
            upcomingAppointments,
            totalDoctors,
            totalLocations,
            recentActivity
          ] = await Promise.all([
            // Total patients (through appointments)
            client.patient.count({
              where: {
                appointments: {
                  some: { clinicId: this.clinicId }
                }
              }
            }),
            
            // Total appointments
            client.appointment.count({
              where: { clinicId: this.clinicId }
            }),
            
            // Today's appointments
            client.appointment.count({
              where: {
                clinicId: this.clinicId,
                date: {
                  gte: today,
                  lt: tomorrow
                }
              }
            }),
            
            // Upcoming appointments (next 7 days)
            client.appointment.count({
              where: {
                clinicId: this.clinicId,
                date: {
                  gte: new Date(),
                  lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                },
                status: {
                  in: ['SCHEDULED', 'CONFIRMED']
                }
              }
            }),
            
            // Total doctors
            client.doctorClinic.count({
              where: { clinicId: this.clinicId }
            }),
            
            // Total locations
            client.clinicLocation.count({
              where: { clinicId: this.clinicId }
            }),
            
            // Recent activity (last 10 appointments)
            client.appointment.findMany({
              where: { clinicId: this.clinicId },
              include: {
                patient: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true
                      }
                    }
                  }
                },
                doctor: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        firstName: true,
                        lastName: true
                      }
                    }
                  }
                }
              },
              orderBy: { updatedAt: 'desc' },
              take: 10
            })
          ]);
          
          return {
            totalPatients,
            totalAppointments,
            todayAppointments,
            upcomingAppointments,
            totalDoctors,
            totalLocations,
            recentActivity
          };
        });
      },
      'GET_CLINIC_DASHBOARD_STATS',
      this.clinicId
    );
  }

  // Private helper methods

  private async validatePatientBelongsToClinic(patientId: string): Promise<RepositoryResult<boolean>> {
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(async (client) => {
          const appointment = await client.appointment.findFirst({
            where: {
              patientId,
              clinicId: this.clinicId
            }
          });
          
          return !!appointment;
        });
      },
      'VALIDATE_PATIENT_CLINIC',
      this.clinicId
    );
  }

  private async validateLocationBelongsToClinic(locationId: string): Promise<RepositoryResult<boolean>> {
    return this.executeWithResult(
      async () => {
        return this.executeWithClinicContext(async (client) => {
          const location = await client.clinicLocation.findFirst({
            where: {
              id: locationId,
              clinicId: this.clinicId
            }
          });
          
          return !!location;
        });
      },
      'VALIDATE_LOCATION_CLINIC',
      this.clinicId
    );
  }

  private async getStaffCount(): Promise<number> {
    try {
      const result = await this.executeWithClinicContext(async (client) => {
        const [doctors, receptionists, admins] = await Promise.all([
          client.doctorClinic.count({ where: { clinicId: this.clinicId } }),
          client.receptionistsAtClinic.count({ where: { A: this.clinicId } }),
          client.clinicAdmin.count({ where: { clinicId: this.clinicId } })
        ]);
        
        return doctors + receptionists + admins;
      });
      
      return result;
    } catch (error) {
      this.logger.error(`Failed to get staff count for clinic ${this.clinicId}:`, error);
      return 0;
    }
  }

  private async getLocationCount(): Promise<number> {
    try {
      return this.executeWithClinicContext(async (client) => {
        return client.clinicLocation.count({ where: { clinicId: this.clinicId } });
      });
    } catch (error) {
      this.logger.error(`Failed to get location count for clinic ${this.clinicId}:`, error);
      return 0;
    }
  }
}