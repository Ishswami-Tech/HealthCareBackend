import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { Role } from '@prisma/client';

@Injectable()
export class ClinicUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async getClinicUsers(clinicId: string) {
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
        `Failed to get clinic users: ${error.message}`,
        'ClinicUserService',
        { clinicId, error: error.stack }
      );
      throw error;
    }
  }

  async getClinicUsersByRole(clinicId: string, role: Role) {
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
        `Failed to get clinic users by role: ${error.message}`,
        'ClinicUserService',
        { clinicId, role, error: error.stack }
      );
      throw error;
    }
  }
} 