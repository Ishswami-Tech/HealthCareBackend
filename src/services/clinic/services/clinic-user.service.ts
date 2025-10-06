import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/libs/infrastructure/database/prisma/prisma.service";
import { LoggingService } from "src/libs/infrastructure/logging/logging.service";
import {
  LogType,
  LogLevel,
} from "src/libs/infrastructure/logging/types/logging.types";
import { Role } from "src/libs/infrastructure/database/prisma/prisma.types";
import { resolveClinicUUID } from "src/libs/utils/clinic.utils";
import type {
  Doctor,
  User,
} from "src/libs/infrastructure/database/prisma/prisma.types";

@Injectable()
export class ClinicUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  async getClinicUsers(clinicId: string): Promise<{
    doctors: Array<{
      id: string;
      clinicId: string;
      doctorId: string;
      doctor: Doctor & { user: User };
    }>;
    receptionists: Array<{
      id: string;
      userId: string;
      clinicId: string;
      user: User;
      clinic: { id: string; name: string };
    }>;
    patients: Array<{
      id: string;
      userId: string;
      user: User;
    }>;
  }> {
    await resolveClinicUUID(this.prisma, clinicId);
    try {
      // Get doctors
      const doctors = await this.prisma.doctorClinic.findMany({
        where: { clinicId },
        include: {
          doctor: {
            include: {
              user: true,
            },
          },
        },
      });

      // Get receptionists
      const receptionists = await this.prisma.receptionist.findMany({
        where: { clinicId },
        include: {
          user: true,
          clinic: true,
        },
      });

      // Get patients with clinic association
      const patients = await this.prisma.patient.findMany({
        where: {
          user: {
            clinics: {
              some: {
                id: clinicId,
              },
            },
          },
        },
        include: {
          user: true,
        },
      });

      return {
        doctors,
        receptionists,
        patients,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users: ${error instanceof Error ? error.message : "Unknown error"}`,
        "ClinicUserService",
        {
          clinicId,
          error:
            error instanceof Error ? error.stack : "No stack trace available",
        },
      );
      throw error;
    }
  }

  async getClinicUsersByRole(clinicId: string, role: Role): Promise<unknown[]> {
    await resolveClinicUUID(this.prisma, clinicId);
    try {
      switch (role) {
        case Role.DOCTOR:
          return await this.prisma.doctorClinic.findMany({
            where: { clinicId },
            include: {
              doctor: {
                include: {
                  user: true,
                },
              },
            },
          });
        case Role.RECEPTIONIST:
          return await this.prisma.receptionist.findMany({
            where: { clinicId },
            include: {
              user: true,
              clinic: true,
            },
          });
        case Role.PATIENT:
          return await this.prisma.patient.findMany({
            where: {
              user: {
                clinics: {
                  some: {
                    id: clinicId,
                  },
                },
              },
            },
            include: {
              user: true,
            },
          });
        default:
          return [];
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users by role: ${error instanceof Error ? error.message : "Unknown error"}`,
        "ClinicUserService",
        {
          clinicId,
          role,
          error:
            error instanceof Error ? error.stack : "No stack trace available",
        },
      );
      throw error;
    }
  }
}
