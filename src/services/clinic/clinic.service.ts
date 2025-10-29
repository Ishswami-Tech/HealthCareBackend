import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../libs/infrastructure/database";
import { LoggingService } from "../../libs/infrastructure/logging";
import {
  LogType,
  LogLevel,
} from "../../libs/infrastructure/logging/types/logging.types";
import {
  ClinicCreateInput,
  ClinicUpdateInput,
  ClinicResponseDto,
} from "./types/clinic.types";

@Injectable()
export class ClinicService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
  ) {}

  async createClinic(data: ClinicCreateInput): Promise<ClinicResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const clinic = await prismaClient.clinic.create({
        data: {
          ...data,
          isActive: data.isActive ?? true,
        },
        include: {
          mainLocation: true,
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic created: ${clinic.id}`,
        "ClinicService",
        { clinicId: clinic.id },
      );

      return clinic as ClinicResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicBySubdomain(
    subdomain: string,
    includeLocation = true,
  ): Promise<ClinicResponseDto | null> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeLocation
        ? {
            mainLocation: true,
          }
        : undefined;

      const clinic = await prismaClient.clinic.findFirst({
        where: { subdomain },
        include,
      });

      return clinic as ClinicResponseDto | null;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic by subdomain: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async updateClinic(
    id: string,
    data: ClinicUpdateInput,
  ): Promise<ClinicResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const clinic = await prismaClient.clinic.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          mainLocation: true,
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic updated: ${clinic.id}`,
        "ClinicService",
        { clinicId: clinic.id },
      );

      return clinic as ClinicResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicCount(): Promise<number> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const count = await prismaClient.clinic.count({
        where: {
          isActive: true,
        },
      });

      return count;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic count: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicStats(clinicId: string): Promise<{
    totalUsers: number;
    totalLocations: number;
    totalAppointments: number;
  }> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const [totalUsers, totalLocations, totalAppointments] = await Promise.all(
        [
          prismaClient.clinicUser.count({
            where: { clinicId, isActive: true },
          }),
          prismaClient.clinicLocation.count({
            where: { clinicId, isActive: true },
          }),
          prismaClient.appointment.count({
            where: { clinicId },
          }),
        ],
      );

      return {
        totalUsers,
        totalLocations,
        totalAppointments,
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic stats: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getAllClinics(userId: string): Promise<ClinicResponseDto[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const clinics = await prismaClient.clinic.findMany({
        where: { createdBy: userId },
        include: { mainLocation: true },
      });
      return clinics as ClinicResponseDto[];
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinics: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicById(
    id: string,
    includeInactive = false,
  ): Promise<ClinicResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const clinic = await prismaClient.clinic.findUnique({
        where: { id, ...(includeInactive ? {} : { isActive: true }) },
        include: { mainLocation: true },
      });
      if (!clinic) throw new Error("Clinic not found");
      return clinic as ClinicResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async deleteClinic(id: string): Promise<void> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      await prismaClient.clinic.delete({ where: { id } });
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic deleted: ${id}`,
        "ClinicService",
        { clinicId: id },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicByAppName(appName: string): Promise<ClinicResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const clinic = await prismaClient.clinic.findFirst({
        where: { app_name: appName },
        include: { mainLocation: true },
      });
      if (!clinic) throw new Error("Clinic not found");
      return clinic as ClinicResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic by app name: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicDoctors(id: string, userId: string): Promise<any[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const doctors = await prismaClient.doctor.findMany({
        where: { clinicId: id },
        include: { user: true },
      });
      return doctors;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic doctors: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicPatients(id: string, userId: string): Promise<any[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const patients = await prismaClient.patient.findMany({
        where: { clinicId: id },
        include: { user: true },
      });
      return patients;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic patients: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getActiveLocations(clinicId: string): Promise<any[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const locations = await prismaClient.clinicLocation.findMany({
        where: { clinicId, isActive: true },
      });
      return locations;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get active locations: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async assignClinicAdmin(data: any): Promise<any> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const admin = await prismaClient.clinicAdmin.create({
        data: { ...data },
        include: { user: true },
      });
      return admin;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to assign clinic admin: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async registerPatientToClinic(data: any): Promise<any> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const patient = await prismaClient.patient.create({
        data: { ...data },
        include: { user: true },
      });
      return patient;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to register patient to clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async associateUserWithClinic(data: any): Promise<any> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const association = await prismaClient.userClinicAssociation.create({
        data: { ...data },
      });
      return association;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to associate user with clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getCurrentUserClinic(userId: string): Promise<ClinicResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();
      const association = await prismaClient.userClinicAssociation.findFirst({
        where: { userId },
        include: { clinic: { include: { mainLocation: true } } },
      });
      if (!association) throw new Error("No clinic association found");
      return association.clinic as ClinicResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get current user clinic: ${(error as Error).message}`,
        "ClinicService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }
}
