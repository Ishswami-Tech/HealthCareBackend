import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClinicPermissionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if a user has permission to access/manage a clinic
   * @param userId The ID of the user
   * @param clinicId The ID of the clinic
   * @returns boolean indicating if the user has permission
   */
  async hasClinicPermission(userId: string, clinicId: string): Promise<boolean> {
    // Check if the user is a super admin by role
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (user?.role === 'SUPER_ADMIN') {
      return true;
    }

    // Check if the user is an admin for this clinic
    const clinicAdmin = await this.prisma.clinicAdmin.findFirst({
      where: {
        userId,
        clinicId,
      },
    });

    return !!clinicAdmin;
  }
} 