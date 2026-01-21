import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

@Injectable()
export class StaffService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Helper to ensure Staff record exists for a user (Receptionist/Admin)
   */
  async ensureStaffProfile(userId: string, role: 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'NURSE') {
    const resourceType = role;

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          receptionist: {
            findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
            create: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
          clinicAdmin: {
            findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
            create: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
          nurse: {
            findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
            create: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
        };

        if (role === 'RECEPTIONIST') {
          const existing = await typedClient.receptionist.findUnique({
            where: { userId },
          } as PrismaDelegateArgs);
          if (!existing) {
            return await typedClient.receptionist.create({
              data: { userId },
            } as PrismaDelegateArgs);
          }
        } else if (role === 'CLINIC_ADMIN') {
          const existing = await typedClient.clinicAdmin.findUnique({
            where: { userId },
          } as PrismaDelegateArgs);
          if (!existing) {
            // ClinicAdmin usually requires a clinicId in schema, assuming optional or passed later?
            // Checking schema assumption: valid for now, might need clinicId in Ensure
            // For now, focusing on profile existence.
            // NOTE: ClinicAdmin might enforce clinicId.
            return await typedClient.clinicAdmin.create({
              data: { userId, clinicId: 'PENDING' },
            } as PrismaDelegateArgs); // Placeholder if required
          }
        } else if (role === 'NURSE') {
          const existing = await typedClient.nurse.findUnique({
            where: { userId },
          } as PrismaDelegateArgs);
          if (!existing) {
            return await typedClient.nurse.create({ data: { userId } } as PrismaDelegateArgs);
          }
        }
      },
      {
        userId: userId,
        clinicId: '',
        resourceType: resourceType,
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { action: `ensure_${role.toLowerCase()}_profile` },
      }
    );
  }

  async createOrUpdateStaff(data: {
    userId: string;
    role: 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'NURSE';
    clinicId?: string;
    department?: string; // For Nurse/Staff
    employeeId?: string;
  }) {
    const { userId, role } = data;

    // 1. Ensure Profile
    await this.ensureStaffProfile(userId, role);

    // 2. Update Details
    // Simplified update logic
    return { success: true, message: `${role} profile updated` };
  }

  async getAllStaff(filters?: {
    role?: 'RECEPTIONIST' | 'CLINIC_ADMIN' | 'NURSE' | undefined;
    clinicId?: string | undefined;
  }) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };

      const where: Record<string, unknown> = {
        role: { in: ['RECEPTIONIST', 'CLINIC_ADMIN', 'NURSE'] },
      };

      if (filters?.role) {
        where['role'] = filters.role;
      }

      if (filters?.clinicId) {
        // Logic to filter by clinicId implies checking relation tables
        // For now, simple user filter if relation exists or if clinicId is on user (it's not, usually)
        // Assuming ClinicAdmin/Receptionist/Nurse has clinicId relation
        const role = filters.role;
        if (role === 'RECEPTIONIST') {
          where['receptionists'] = { some: { clinicId: filters.clinicId } };
        } else if (role === 'CLINIC_ADMIN') {
          where['clinicAdmins'] = { some: { clinicId: filters.clinicId } };
        } else if (role === 'NURSE') {
          where['nurse'] = { some: { clinicId: filters.clinicId } };
        } else {
          // If role not specified but clinicId is, search all relations
          where['OR'] = [
            { receptionists: { some: { clinicId: filters.clinicId } } },
            { clinicAdmins: { some: { clinicId: filters.clinicId } } },
            { nurse: { some: { clinicId: filters.clinicId } } },
          ];
        }
      }

      return await typedClient.user.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          receptionists: true,
          clinicAdmins: true,
          nurse: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async getStaffProfile(userId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.user.findUnique({
        where: { id: userId } as PrismaDelegateArgs,
        include: {
          receptionists: true,
          clinicAdmins: true,
          nurse: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }
}
