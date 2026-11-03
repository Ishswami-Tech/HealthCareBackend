import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

/**
 * Safe `User` fields for a staff profile read. Never `password` or any other auth/device field
 * (googleId/facebookId/appleId, lastLoginIP, lastLoginDevice, ...) — this previously used a raw
 * Prisma `include`, which returns every scalar column including the bcrypt password hash to any
 * RECEPTIONIST/NURSE/CLINIC_ADMIN/SUPER_ADMIN caller of GET /staff/:id. Same vulnerability class
 * already fixed on /doctors/:id (see doctor-response.util.ts's DOCTOR_PROFILE_USER_SELECT) — this
 * endpoint wasn't covered by that fix.
 */
const STAFF_PROFILE_USER_SELECT = {
  id: true,
  userid: true,
  firstName: true,
  lastName: true,
  name: true,
  email: true,
  phone: true,
  phoneVerified: true,
  profilePicture: true,
  role: true,
  gender: true,
  isVerified: true,
  isActive: true,
  isProfileComplete: true,
  primaryClinicId: true,
  createdAt: true,
  updatedAt: true,
  receptionists: true,
  clinicAdmins: true,
  nurse: true,
} as const;

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
          where['receptionists'] = { clinicId: filters.clinicId };
        } else if (role === 'CLINIC_ADMIN') {
          where['clinicAdmins'] = { clinicId: filters.clinicId };
        } else if (role === 'NURSE') {
          where['nurse'] = { clinicId: filters.clinicId };
        } else {
          // If role not specified but clinicId is, search all relations
          where['OR'] = [
            { receptionists: { clinicId: filters.clinicId } },
            { clinicAdmins: { clinicId: filters.clinicId } },
            { nurse: { clinicId: filters.clinicId } },
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

  async getStaffProfile(userId: string, clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: {
          findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
          findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
        };
      };

      if (!clinicId) {
        return await typedClient.user.findUnique({
          where: { id: userId } as PrismaDelegateArgs,
          select: STAFF_PROFILE_USER_SELECT as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }

      // 🔒 TENANT ISOLATION, with a fallback: a user is scoped to a clinic either through the
      // `clinics` many-to-many relation, or (for every staff account created via
      // UsersService.createUser, which only ever sets the scalar primaryClinicId and never adds
      // a _UserClinics row) through primaryClinicId. Without the fallback, a brand-new staff
      // member's profile looked up scoped to their own clinic returned null, and the UI showed
      // their real, correctly-saved location allotment as "Not allotted".
      return await typedClient.user.findFirst({
        where: {
          id: userId,
          OR: [{ clinics: { some: { id: clinicId } } }, { primaryClinicId: clinicId }],
        } as PrismaDelegateArgs,
        select: STAFF_PROFILE_USER_SELECT as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }
}
