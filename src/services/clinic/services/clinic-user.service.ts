import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  ClinicUserCreateInput,
  ClinicUserUpdateInput,
  ClinicUserResponseDto,
} from '@core/types/clinic.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type { UserRoleEntity } from '@core/types/database.types';

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
      const clinicUser = await this.databaseService.executeHealthcareWrite<
        UserRoleEntity & {
          user: { id: string; name: string; email: string; phone: string | null };
          role: { id: string; name: string; displayName: string };
        }
      >(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          // First, find or get the roleId for the given role name
          const role = await typedClient.rbacRole.findFirst({
            where: {
              name: data.role,
              ...(data.clinicId && { clinicId: data.clinicId }),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          if (!role) {
            throw new Error(`Role ${data.role} not found`);
          }

          const typedRole = role as { id: string };
          // Create UserRole entry
          const result = await typedClient.userRole.create({
            data: {
              userId: data.userId,
              roleId: typedRole.id,
              clinicId: data.clinicId || null,
              isActive: data.isActive ?? true,
              assignedBy: 'system',
            } as PrismaDelegateArgs,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              role: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as UserRoleEntity & {
            user: { id: string; name: string; email: string; phone: string | null };
            role: { id: string; name: string; displayName: string };
          };
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

      const clinicUsers = await this.databaseService.executeHealthcareRead<
        Array<
          UserRoleEntity & {
            user?: { id: string; name: string; email: string; phone: string | null } | null;
            role: { name: string };
          }
        >
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.userRole.findMany({
          where: {
            clinicId,
            isActive: true,
          } as PrismaDelegateArgs,
          include: include as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as Array<
          UserRoleEntity & {
            user?: { id: string; name: string; email: string; phone: string | null } | null;
            role: { name: string };
          }
        >;
      });

      // Transform to ClinicUserResponseDto format
      return clinicUsers.map(
        (cu: {
          id: string;
          userId: string;
          clinicId: string | null;
          role: { name: string } | string;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
          user?: { id: string; name: string; email: string; phone: string | null } | null;
        }) => ({
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
        })
      ) as ClinicUserResponseDto[];
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

      const clinicUsers = await this.databaseService.executeHealthcareRead<
        Array<
          UserRoleEntity & {
            user?: { id: string; name: string; email: string; phone: string | null } | null;
            role: { name: string };
          }
        >
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // First find roleId for the role name
        const roleEntity = await typedClient.rbacRole.findFirst({
          where: {
            name: role,
            ...(clinicId && { clinicId }),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!roleEntity) {
          return [];
        }

        const typedRoleEntity = roleEntity as { id: string };
        const result = await typedClient.userRole.findMany({
          where: {
            clinicId,
            roleId: typedRoleEntity.id,
            isActive: true,
          } as PrismaDelegateArgs,
          include: include as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as Array<
          UserRoleEntity & {
            user?: { id: string; name: string; email: string; phone: string | null } | null;
            role: { name: string };
          }
        >;
      });

      // Transform to ClinicUserResponseDto format
      return clinicUsers.map(
        (cu: {
          id: string;
          userId: string;
          clinicId: string | null;
          role: { name: string } | string;
          isActive: boolean;
          createdAt: Date;
          updatedAt: Date;
          user?: { id: string; name: string; email: string; phone: string | null } | null;
        }) => ({
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
        })
      ) as ClinicUserResponseDto[];
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

      const clinicUser = await this.databaseService.executeHealthcareRead<
        | (UserRoleEntity & {
            user?: { id: string; name: string; email: string; phone: string | null } | null;
            role: { name: string };
          })
        | null
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.userRole.findUnique({
          where: { id } as PrismaDelegateArgs,
          include: include as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as
          | (UserRoleEntity & {
              user?: { id: string; name: string; email: string; phone: string | null } | null;
              role: { name: string };
            })
          | null;
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
      const clinicUser = await this.databaseService.executeHealthcareWrite<
        UserRoleEntity & {
          user: { id: string; name: string; email: string; phone: string | null };
          role: { id: string; name: string; displayName: string };
        }
      >(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const updateData: { isActive?: boolean; roleId?: string } = {};

          if (data.isActive !== undefined) {
            updateData.isActive = data.isActive;
          }

          if (data.role) {
            // Find roleId for the role name
            const role = await typedClient.rbacRole.findFirst({
              where: {
                name: data.role,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);

            if (!role) {
              throw new Error(`Role ${data.role} not found`);
            }

            const typedRole = role as { id: string };
            updateData.roleId = typedRole.id;
          }

          const result = await typedClient.userRole.update({
            where: { id } as PrismaDelegateArgs,
            data: updateData as PrismaDelegateArgs,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              role: {
                select: {
                  id: true,
                  name: true,
                  displayName: true,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as UserRoleEntity & {
            user: { id: string; name: string; email: string; phone: string | null };
            role: { id: string; name: string; displayName: string };
          };
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
      await this.databaseService.executeHealthcareWrite<UserRoleEntity>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.userRole.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              isActive: false,
              revokedAt: new Date(),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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
      const count = await this.databaseService.executeHealthcareRead<number>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.userRole.count({
          where: {
            clinicId,
            isActive: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
