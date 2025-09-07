import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/libs/infrastructure/database/prisma/prisma.service';
import { LoggingService } from 'src/libs/infrastructure/logging/logging.service';
import { LogType, LogLevel } from 'src/libs/infrastructure/logging/types/logging.types';
import { Role } from 'src/libs/infrastructure/database/prisma/prisma.types';
import { resolveClinicUUID } from 'src/libs/utils/clinic.utils';

@Injectable()
export class ClinicUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async getClinicUsers(clinicId: string) {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      // Get doctors
      const doctors = await this.prisma.doctorClinic.findMany({
        where: { clinicId },
        include: {
          doctor: {
            include: {
              user: true
            }
          }
        }
      });

      // Get receptionists
      const receptionists = await this.prisma.receptionist.findMany({
        where: { clinicId },
        include: {
          user: true,
          clinic: true
        }
      });

      // Get patients with clinic association
      const patients = await this.prisma.patient.findMany({
        where: {
          user: {
            clinics: {
              some: {
                id: clinicId
              }
            }
          }
        },
        include: {
          user: true
        }
      });

      return {
        doctors,
        receptionists,
        patients
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        'ClinicUserService',
        { clinicId, error: error instanceof Error ? (error as Error).stack : 'No stack trace available' }
      );
      throw error;
    }
  }

  async getClinicUsersByRole(clinicId: string, role: Role) {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      switch (role) {
        case Role.DOCTOR:
          return await this.prisma.doctorClinic.findMany({
            where: { clinicId },
            include: {
              doctor: {
                include: {
                  user: true
                }
              }
            }
          });
        case Role.RECEPTIONIST:
          return await this.prisma.receptionist.findMany({
            where: { clinicId },
            include: {
              user: true,
              clinic: true
            }
          });
        case Role.PATIENT:
          return await this.prisma.patient.findMany({
            where: {
              user: {
                clinics: {
                  some: {
                    id: clinicId
                  }
                }
              }
            },
            include: {
              user: true
            }
          });
        default:
          return [];
      }
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users by role: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        'ClinicUserService',
        { clinicId, role, error: error instanceof Error ? (error as Error).stack : 'No stack trace available' }
      );
      throw error;
    }
  }
} 