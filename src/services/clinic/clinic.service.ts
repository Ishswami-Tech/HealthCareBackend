import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ClinicDatabaseService } from './clinic-database.service';
import { Role } from '@prisma/client';

@Injectable()
export class ClinicService {
  constructor(
    private prisma: PrismaService,
    private clinicDatabaseService: ClinicDatabaseService,
  ) {}

  /**
   * Create a new clinic
   * Only SuperAdmin can create clinics
   */
  async createClinic(data: {
    name: string;
    address: string;
    phone: string;
    app_name: string;
    createdBy: string; // User ID of the creator (must be SuperAdmin)
  }) {
    // Check if the user is a SuperAdmin
    const user = await this.prisma.user.findUnique({
      where: { id: data.createdBy },
      include: { superAdmin: true },
    });

    if (!user || user.role !== Role.SUPER_ADMIN || !user.superAdmin) {
      throw new UnauthorizedException('Only SuperAdmin can create clinics');
    }

    // Check if a clinic with the same name or app_name already exists
    const existingClinic = await this.prisma.clinic.findFirst({
      where: {
        OR: [
          { name: data.name },
          { app_name: data.app_name } as any // Use type assertion to bypass type checking
        ]
      },
    });

    if (existingClinic) {
      throw new ConflictException(
        existingClinic.name === data.name
          ? 'A clinic with this name already exists'
          : 'A clinic with this app name already exists'
      );
    }

    try {
      // Create the clinic in the global database
      const clinic = await this.prisma.clinic.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          app_name: data.app_name,
          db_connection_string: 'pending', // Temporary value
        } as any, // Use type assertion to bypass type checking
      });

      // Generate a database connection string for the clinic
      const dbConnectionString = `postgresql://postgres:postgres@postgres:5432/clinic_${data.app_name.toLowerCase().replace(/\s+/g, '_')}?schema=public`;

      // Update the clinic with the actual connection string
      try {
        return await this.prisma.clinic.update({
          where: { id: clinic.id },
          data: { db_connection_string: dbConnectionString } as any, // Use type assertion to bypass type checking
        });
      } catch (error) {
        // If there's an error, delete the clinic from the global database
        await this.prisma.clinic.delete({ where: { id: clinic.id } });
        throw error;
      }
    } catch (error) {
      throw new ConflictException(`Failed to create clinic: ${error.message}`);
    }
  }

  /**
   * Get all clinics
   * SuperAdmin can see all clinics
   * ClinicAdmin can only see their assigned clinics
   */
  async getAllClinics(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // SuperAdmin can see all clinics
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      return this.prisma.clinic.findMany({
        include: {
          admins: {
            include: {
              user: true,
            },
          },
        },
      });
    }

    // ClinicAdmin can only see their assigned clinics
    if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      return this.prisma.clinic.findMany({
        where: {
          admins: {
            some: {
              userId: userId,
            },
          },
        },
        include: {
          admins: {
            include: {
              user: true,
            },
          },
        },
      });
    }

    throw new UnauthorizedException('You do not have permission to view clinics');
  }

  /**
   * Get a clinic by ID
   * SuperAdmin can see any clinic
   * ClinicAdmin can only see their assigned clinics
   */
  async getClinicById(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const clinic = await this.prisma.clinic.findUnique({
      where: { id },
      include: {
        admins: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // SuperAdmin can see any clinic
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      return clinic;
    }

    // ClinicAdmin can only see their assigned clinics
    if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      const isAdmin = clinic.admins.some((admin) => admin.userId === userId);
      if (isAdmin) {
        return clinic;
      }
    }

    throw new UnauthorizedException('You do not have permission to view this clinic');
  }

  /**
   * Get a clinic by app name
   * This is used for public access to determine which clinic database to connect to
   */
  async getClinicByAppName(appName: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { app_name: appName } as any, // Use type assertion to bypass type checking
      include: {
        admins: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    return clinic;
  }

  /**
   * Assign a user as a clinic admin
   * Only SuperAdmin can assign clinic admins
   */
  async assignClinicAdmin(data: {
    clinicId: string;
    userId: string; // User ID to be assigned as clinic admin
    assignedBy: string; // User ID of the assigner (must be SuperAdmin)
  }) {
    // Check if the assigner is a SuperAdmin
    const assigner = await this.prisma.user.findUnique({
      where: { id: data.assignedBy },
      include: { superAdmin: true },
    });

    if (!assigner || assigner.role !== Role.SUPER_ADMIN || !assigner.superAdmin) {
      throw new UnauthorizedException('Only SuperAdmin can assign clinic admins');
    }

    // Check if the clinic exists
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: data.clinicId },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user exists and is not already a clinic admin
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      include: { clinicAdmin: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.clinicAdmin) {
      throw new ConflictException('User is already a clinic admin');
    }

    // Update the user's role to CLINIC_ADMIN
    await this.prisma.user.update({
      where: { id: data.userId },
      data: { role: Role.CLINIC_ADMIN },
    });

    // Create a clinic admin record
    return this.prisma.clinicAdmin.create({
      data: {
        userId: data.userId,
        clinicId: data.clinicId,
      },
      include: {
        user: true,
        clinic: true,
      },
    });
  }

  /**
   * Remove a clinic admin
   * Only SuperAdmin can remove clinic admins
   */
  async removeClinicAdmin(data: {
    clinicAdminId: string;
    removedBy: string; // User ID of the remover (must be SuperAdmin)
  }) {
    // Check if the remover is a SuperAdmin
    const remover = await this.prisma.user.findUnique({
      where: { id: data.removedBy },
      include: { superAdmin: true },
    });

    if (!remover || remover.role !== Role.SUPER_ADMIN || !remover.superAdmin) {
      throw new UnauthorizedException('Only SuperAdmin can remove clinic admins');
    }

    // Check if the clinic admin exists
    const clinicAdmin = await this.prisma.clinicAdmin.findUnique({
      where: { id: data.clinicAdminId },
      include: { user: true },
    });

    if (!clinicAdmin) {
      throw new NotFoundException('Clinic admin not found');
    }

    // Delete the clinic admin record
    await this.prisma.clinicAdmin.delete({
      where: { id: data.clinicAdminId },
    });

    // Update the user's role back to USER if they don't have any other clinic admin roles
    const otherClinicAdminRoles = await this.prisma.clinicAdmin.findFirst({
      where: { userId: clinicAdmin.userId },
    });

    if (!otherClinicAdminRoles) {
      await this.prisma.user.update({
        where: { id: clinicAdmin.userId },
        data: { role: Role.PATIENT }, // Default to PATIENT role
      });
    }

    return { message: 'Clinic admin removed successfully' };
  }

  /**
   * Get all doctors for a specific clinic
   * SuperAdmin and ClinicAdmin can see all doctors
   */
  async getClinicDoctors(clinicId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if the clinic exists
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user has permission to view this clinic's doctors
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      // SuperAdmin can see all doctors
    } else if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      // ClinicAdmin can only see doctors from their assigned clinics
      const isAdmin = await this.prisma.clinicAdmin.findFirst({
        where: {
          userId: userId,
          clinicId: clinicId,
        },
      });

      if (!isAdmin) {
        throw new UnauthorizedException('You do not have permission to view doctors from this clinic');
      }
    } else {
      throw new UnauthorizedException('You do not have permission to view doctors');
    }

    // Get all doctors for this clinic
    return this.prisma.doctorClinic.findMany({
      where: { clinicId },
      include: {
        doctor: {
          include: {
            user: true,
          },
        },
      },
    });
  }

  /**
   * Get all patients for a specific clinic
   * SuperAdmin and ClinicAdmin can see all patients
   */
  async getClinicPatients(clinicId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        superAdmin: true,
        clinicAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if the clinic exists
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user has permission to view this clinic's patients
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      // SuperAdmin can see all patients
    } else if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
      // ClinicAdmin can only see patients from their assigned clinics
      const isAdmin = await this.prisma.clinicAdmin.findFirst({
        where: {
          userId: userId,
          clinicId: clinicId,
        },
      });

      if (!isAdmin) {
        throw new UnauthorizedException('You do not have permission to view patients from this clinic');
      }
    } else {
      throw new UnauthorizedException('You do not have permission to view patients');
    }

    // Connect to the clinic's database to get patients
    // This is a placeholder - in a real implementation, you would query the clinic's database
    // For now, we'll just return an empty array
    return [];
  }

  /**
   * Register a patient to a clinic
   * This is used by the mobile app to register a patient to a specific clinic
   */
  async registerPatientToClinic(data: {
    userId: string;
    appName: string;
  }) {
    // Get the clinic by app name
    const clinic = await this.prisma.clinic.findUnique({
      where: { app_name: data.appName } as any, // Use type assertion to bypass type checking
    });

    if (!clinic) {
      throw new NotFoundException('Clinic not found');
    }

    // Check if the user exists and is a patient
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
      include: { patient: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== Role.PATIENT || !user.patient) {
      throw new ConflictException('User is not a patient');
    }

    // Connect to the clinic's database and register the patient
    // This is a placeholder - in a real implementation, you would create a record in the clinic's database
    // For now, we'll just return a success message
    return { message: 'Patient registered to clinic successfully' };
  }
} 