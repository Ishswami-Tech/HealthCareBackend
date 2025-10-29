import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../libs/infrastructure/database";
import { LoggingService } from "../../../libs/infrastructure/logging";
import {
  LogType,
  LogLevel,
} from "../../../libs/infrastructure/logging/types/logging.types";
import {
  ClinicUserCreateInput,
  ClinicUserUpdateInput,
  ClinicUserResponseDto,
} from "../types/clinic-user.types";

@Injectable()
export class ClinicUserService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
  ) {}

  async createClinicUser(
    data: ClinicUserCreateInput,
    _userId: string,
  ): Promise<ClinicUserResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const clinicUser = await prismaClient.clinicUser.create({
        data: {
          ...data,
          isActive: data.isActive ?? true,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              isActive: true,
            },
          },
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user created: ${clinicUser.id}`,
        "ClinicUserService",
        { clinicUserId: clinicUser.id },
      );

      return clinicUser as ClinicUserResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic user: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicUsers(
    clinicId: string,
    includeUser = true,
  ): Promise<ClinicUserResponseDto[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeUser
        ? {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
              },
            },
          }
        : undefined;

      const clinicUsers = await prismaClient.clinicUser.findMany({
        where: {
          clinicId,
          isActive: true,
        },
        include,
      });

      return clinicUsers as ClinicUserResponseDto[];
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicUsersByRole(
    clinicId: string,
    role: string,
    includeUser = true,
  ): Promise<ClinicUserResponseDto[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeUser
        ? {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
              },
            },
          }
        : undefined;

      const clinicUsers = await prismaClient.clinicUser.findMany({
        where: {
          clinicId,
          role,
          isActive: true,
        },
        include,
      });

      return clinicUsers as ClinicUserResponseDto[];
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users by role: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicUserById(
    id: string,
    includeUser = true,
  ): Promise<ClinicUserResponseDto | null> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeUser
        ? {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
              },
            },
          }
        : undefined;

      const clinicUser = await prismaClient.clinicUser.findFirst({
        where: { id },
        include,
      });

      return clinicUser as ClinicUserResponseDto | null;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic user: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async updateClinicUser(
    id: string,
    data: ClinicUserUpdateInput,
    _userId: string,
  ): Promise<ClinicUserResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const clinicUser = await prismaClient.clinicUser.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              isActive: true,
            },
          },
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user updated: ${clinicUser.id}`,
        "ClinicUserService",
        { clinicUserId: clinicUser.id },
      );

      return clinicUser as ClinicUserResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic user: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async deleteClinicUser(id: string, _userId: string): Promise<void> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      await prismaClient.clinicUser.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user deactivated: ${id}`,
        "ClinicUserService",
        { clinicUserId: id },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic user: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicUserCount(clinicId: string): Promise<number> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const count = await prismaClient.clinicUser.count({
        where: {
          clinicId,
          isActive: true,
        },
      });

      return count;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic user count: ${(error as Error).message}`,
        "ClinicUserService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }
}
