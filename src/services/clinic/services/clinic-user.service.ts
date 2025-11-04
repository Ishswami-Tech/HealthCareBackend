import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  ClinicUserCreateInput,
  ClinicUserUpdateInput,
  ClinicUserResponseDto,
} from '@core/types/clinic.types';

@Injectable()
export class ClinicUserService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async createClinicUser(
    data: ClinicUserCreateInput,
    _userId: string
  ): Promise<ClinicUserResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic user creation via UserRole
      // Note: ClinicUser is managed through UserRole model in RBAC system
      const clinicUser = await this.databaseService.executeHealthcareWrite(
        async client => {
          // First, find or get the roleId for the given role name
          const role = await client.rbacRole.findFirst({
            where: {
              name: data.role,
              ...(data.clinicId && { clinicId: data.clinicId }),
            },
          });

          if (!role) {
            throw new Error(`Role ${data.role} not found`);
          }

          // Create UserRole entry
          return await client.userRole.create({
            data: {
              userId: data.userId,
              roleId: role.id,
              clinicId: data.clinicId || null,
              isActive: data.isActive ?? true,
              assignedBy: 'system',
            },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
              role: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          });
        },
        {
          userId: data.userId || _userId || 'system',
          clinicId: data.clinicId || '',
          resourceType: 'CLINIC_USER',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { userId: data.userId, clinicId: data.clinicId, role: data.role },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user created: ${clinicUser.id}`,
        'ClinicUserService',
        { clinicUserId: clinicUser.id }
      );

      // Transform to ClinicUserResponseDto format
      return {
        id: clinicUser.id,
        userId: clinicUser.userId,
        clinicId: clinicUser.clinicId || '',
        role: typeof clinicUser.role === 'string' ? clinicUser.role : clinicUser.role.name,
        isActive: clinicUser.isActive,
        createdAt: clinicUser.createdAt,
        updatedAt: clinicUser.updatedAt,
        user: clinicUser.user
          ? {
              id: clinicUser.user.id,
              name: clinicUser.user.name,
              email: clinicUser.user.email,
              phone: clinicUser.user.phone || undefined,
              isActive: true,
            }
          : undefined,
      } as ClinicUserResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic user: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicUsers(clinicId: string, includeUser = true): Promise<ClinicUserResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query via UserRole
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
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          }
        : {
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          };

      const clinicUsers = await this.databaseService.executeHealthcareRead(async client => {
        return await client.userRole.findMany({
          where: {
            clinicId,
            isActive: true,
          },
          include,
        });
      });

      // Transform to ClinicUserResponseDto format
      return clinicUsers.map(cu => ({
        id: cu.id,
        userId: cu.userId,
        clinicId: cu.clinicId || '',
        role: typeof cu.role === 'string' ? cu.role : cu.role.name,
        isActive: cu.isActive,
        createdAt: cu.createdAt,
        updatedAt: cu.updatedAt,
        user: cu.user
          ? {
              id: cu.user.id,
              name: cu.user.name,
              email: cu.user.email,
              phone: cu.user.phone || undefined,
              isActive: true,
            }
          : undefined,
      })) as ClinicUserResponseDto[];
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicUsersByRole(
    clinicId: string,
    role: string,
    includeUser = true
  ): Promise<ClinicUserResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query via UserRole with role filter
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
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          }
        : {
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          };

      const clinicUsers = await this.databaseService.executeHealthcareRead(async client => {
        // First find roleId for the role name
        const roleEntity = await client.rbacRole.findFirst({
          where: {
            name: role,
            ...(clinicId && { clinicId }),
          },
        });

        if (!roleEntity) {
          return [];
        }

        return await client.userRole.findMany({
          where: {
            clinicId,
            roleId: roleEntity.id,
            isActive: true,
          },
          include,
        });
      });

      // Transform to ClinicUserResponseDto format
      return clinicUsers.map(cu => ({
        id: cu.id,
        userId: cu.userId,
        clinicId: cu.clinicId || '',
        role: typeof cu.role === 'string' ? cu.role : cu.role.name,
        isActive: cu.isActive,
        createdAt: cu.createdAt,
        updatedAt: cu.updatedAt,
        user: cu.user
          ? {
              id: cu.user.id,
              name: cu.user.name,
              email: cu.user.email,
              phone: cu.user.phone || undefined,
              isActive: true,
            }
          : undefined,
      })) as ClinicUserResponseDto[];
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic users by role: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicUserById(id: string, includeUser = true): Promise<ClinicUserResponseDto | null> {
    try {
      // Use executeHealthcareRead for optimized query via UserRole
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
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          }
        : {
            role: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          };

      const clinicUser = await this.databaseService.executeHealthcareRead(async client => {
        return await client.userRole.findUnique({
          where: { id },
          include,
        });
      });

      if (!clinicUser) {
        return null;
      }

      // Transform to ClinicUserResponseDto format
      return {
        id: clinicUser.id,
        userId: clinicUser.userId,
        clinicId: clinicUser.clinicId || '',
        role: typeof clinicUser.role === 'string' ? clinicUser.role : clinicUser.role.name,
        isActive: clinicUser.isActive,
        createdAt: clinicUser.createdAt,
        updatedAt: clinicUser.updatedAt,
        user: clinicUser.user
          ? {
              id: clinicUser.user.id,
              name: clinicUser.user.name,
              email: clinicUser.user.email,
              phone: clinicUser.user.phone || undefined,
              isActive: true,
            }
          : undefined,
      } as ClinicUserResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic user: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async updateClinicUser(
    id: string,
    data: ClinicUserUpdateInput,
    _userId: string
  ): Promise<ClinicUserResponseDto> {
    try {
      // Use executeHealthcareWrite for update with full optimization layers via UserRole
      const clinicUser = await this.databaseService.executeHealthcareWrite(
        async client => {
          const updateData: { isActive?: boolean; roleId?: string } = {};

          if (data.isActive !== undefined) {
            updateData.isActive = data.isActive;
          }

          if (data.role) {
            // Find roleId for the role name
            const role = await client.rbacRole.findFirst({
              where: {
                name: data.role,
              },
            });

            if (!role) {
              throw new Error(`Role ${data.role} not found`);
            }

            updateData.roleId = role.id;
          }

          return await client.userRole.update({
            where: { id },
            data: updateData,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
              role: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                },
              },
            },
          });
        },
        {
          userId: _userId || 'system',
          clinicId: '',
          resourceType: 'CLINIC_USER',
          operation: 'UPDATE',
          resourceId: id,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user updated: ${clinicUser.id}`,
        'ClinicUserService',
        { clinicUserId: clinicUser.id }
      );

      // Transform to ClinicUserResponseDto format
      return {
        id: clinicUser.id,
        userId: clinicUser.userId,
        clinicId: clinicUser.clinicId || '',
        role: typeof clinicUser.role === 'string' ? clinicUser.role : clinicUser.role.name,
        isActive: clinicUser.isActive,
        createdAt: clinicUser.createdAt,
        updatedAt: clinicUser.updatedAt,
        user: clinicUser.user
          ? {
              id: clinicUser.user.id,
              name: clinicUser.user.name,
              email: clinicUser.user.email,
              phone: clinicUser.user.phone || undefined,
              isActive: true,
            }
          : undefined,
      } as ClinicUserResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic user: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async deleteClinicUser(id: string, _userId: string): Promise<void> {
    try {
      // Use executeHealthcareWrite for soft delete with audit logging via UserRole
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.userRole.update({
            where: { id },
            data: {
              isActive: false,
              revokedAt: new Date(),
            },
          });
        },
        {
          userId: _userId || 'system',
          clinicId: '',
          resourceType: 'CLINIC_USER',
          operation: 'DELETE',
          resourceId: id,
          userRole: 'system',
          details: { clinicUserId: id, softDelete: true },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic user deactivated: ${id}`,
        'ClinicUserService',
        { clinicUserId: id }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic user: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicUserCount(clinicId: string): Promise<number> {
    try {
      // Use executeHealthcareRead for count query via UserRole
      const count = await this.databaseService.executeHealthcareRead(async client => {
        return await client.userRole.count({
          where: {
            clinicId,
            isActive: true,
          },
        });
      });

      return count;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic user count: ${(error as Error).message}`,
        'ClinicUserService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }
}
