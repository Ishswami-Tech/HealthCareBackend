import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { ClinicDatabaseService } from './clinic-database.service';
import { Role } from '@prisma/client';
import { LoggingService } from '../../shared/logging/logging.service';
import { EventService } from '../../shared/events/event.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';

@Injectable()
export class ClinicService {
  constructor(
    private prisma: PrismaService,
    private clinicDatabaseService: ClinicDatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
  ) {}

  /**
   * Create a new clinic
   * Only SuperAdmin can create clinics
   */
  async createClinic(data: {
    name: string;
    address: string;
    phone: string;
    email: string;
    createdBy: string;
  }) {
    try {
      const creator = await this.prisma.user.findUnique({
        where: { id: data.createdBy },
        include: { superAdmin: true },
      });

      if (!creator || creator.role !== Role.SUPER_ADMIN || !creator.superAdmin) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized clinic creation attempt',
          'ClinicService',
          { userId: data.createdBy }
        );
        throw new UnauthorizedException('Only SuperAdmin can create clinics');
      }

      const existingClinic = await this.prisma.clinic.findFirst({
        where: {
          OR: [
            { name: data.name },
            { email: data.email }
          ]
        },
      });

      if (existingClinic) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic creation failed - duplicate name or email',
          'ClinicService',
          { name: data.name, email: data.email }
        );
        throw new ConflictException(
          existingClinic.name === data.name
            ? 'A clinic with this name already exists'
            : 'A clinic with this email already exists'
        );
      }

      const clinic = await this.prisma.clinic.create({
        data: {
          name: data.name,
          address: data.address,
          phone: data.phone,
          email: data.email,
          app_name: data.email, // Use email as app_name for now
          db_connection_string: 'pending', // Will be updated after database creation
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
      });

      const dbConnectionString = await this.clinicDatabaseService.createClinicDatabase(
        clinic.id,
        data.email
      );

      const updatedClinic = await this.prisma.clinic.update({
        where: { id: clinic.id },
        data: { db_connection_string: dbConnectionString },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic created successfully',
        'ClinicService',
        { clinicId: clinic.id, name: data.name }
      );

      await this.eventService.emit('clinic.created', {
        clinicId: clinic.id,
        name: data.name,
        email: data.email,
        createdBy: data.createdBy
      });

      return updatedClinic;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create clinic',
        'ClinicService',
        { error: error.message, ...data }
      );
      throw error;
    }
  }

  /**
   * Get all clinics
   * SuperAdmin can see all clinics
   * ClinicAdmin can only see their assigned clinics
   */
  async getAllClinics(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId
        },
        include: {
          superAdmin: true,
          clinicAdmin: true
        }
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while fetching clinics',
          'ClinicService',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      let clinics;
      if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
        clinics = await this.prisma.clinic.findMany({
          include: {
            admins: {
              include: {
                user: true,
              },
            },
          },
        });
      } else if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
        clinics = await this.prisma.clinic.findMany({
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
      } else {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized clinic access attempt',
          'ClinicService',
          { userId, role: user.role }
        );
        throw new UnauthorizedException('You do not have permission to view clinics');
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinics fetched successfully',
        'ClinicService',
        { userId, count: clinics.length }
      );

      return clinics;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch clinics',
        'ClinicService',
        { error: error.message, userId }
      );
      throw error;
    }
  }

  /**
   * Get a clinic by ID
   * SuperAdmin can see any clinic
   * ClinicAdmin can only see their assigned clinics
   */
  async getClinicById(id: string, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          superAdmin: true,
          clinicAdmin: true,
        },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while fetching clinic',
          'ClinicService',
          { userId }
        );
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
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic not found',
          'ClinicService',
          { clinicId: id }
        );
        throw new NotFoundException('Clinic not found');
      }

      if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Clinic fetched by super admin',
          'ClinicService',
          { clinicId: id, userId }
        );
        return clinic;
      }

      if (user.role === Role.CLINIC_ADMIN && user.clinicAdmin) {
        const isAdmin = clinic.admins.some((admin) => admin.userId === userId);
        if (isAdmin) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Clinic fetched by clinic admin',
            'ClinicService',
            { clinicId: id, userId }
          );
          return clinic;
        }
      }

      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Unauthorized clinic access attempt',
        'ClinicService',
        { clinicId: id, userId, role: user.role }
      );
      throw new UnauthorizedException('You do not have permission to view this clinic');
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch clinic',
        'ClinicService',
        { error: error.message, clinicId: id, userId }
      );
      throw error;
    }
  }

  /**
   * Get a clinic by app name
   * This is used for public access to determine which clinic database to connect to
   */
  async getClinicByAppName(appName: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { email: appName },
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
      where: { email: data.appName } as any, // Use type assertion to bypass type checking
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

  async updateClinic(id: string, data: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
  }, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          superAdmin: true,
          clinicAdmin: true,
        },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while updating clinic',
          'ClinicService',
          { userId }
        );
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
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic not found for update',
          'ClinicService',
          { clinicId: id }
        );
        throw new NotFoundException('Clinic not found');
      }

      if (user.role !== Role.SUPER_ADMIN) {
        if (user.role === Role.CLINIC_ADMIN) {
          const isAdmin = clinic.admins.some((admin) => admin.userId === userId);
          if (!isAdmin) {
            await this.loggingService.log(
              LogType.SECURITY,
              LogLevel.WARN,
              'Unauthorized clinic update attempt',
              'ClinicService',
              { clinicId: id, userId, role: user.role }
            );
            throw new UnauthorizedException('You do not have permission to update this clinic');
          }
        } else {
          await this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            'Unauthorized clinic update attempt',
            'ClinicService',
            { clinicId: id, userId, role: user.role }
          );
          throw new UnauthorizedException('You do not have permission to update clinics');
        }
      }

      const updatedClinic = await this.prisma.clinic.update({
        where: { id },
        data,
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic updated successfully',
        'ClinicService',
        { clinicId: id, updatedFields: Object.keys(data) }
      );

      await this.eventService.emit('clinic.updated', {
        clinicId: id,
        updatedFields: Object.keys(data),
        updatedBy: userId
      });

      return updatedClinic;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update clinic',
        'ClinicService',
        { error: error.message, clinicId: id, ...data }
      );
      throw error;
    }
  }

  async deleteClinic(id: string, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while deleting clinic',
          'ClinicService',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      if (user.role !== Role.SUPER_ADMIN) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized clinic deletion attempt',
          'ClinicService',
          { clinicId: id, userId, role: user.role }
        );
        throw new UnauthorizedException('Only SuperAdmin can delete clinics');
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
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Clinic not found for deletion',
          'ClinicService',
          { clinicId: id }
        );
        throw new NotFoundException('Clinic not found');
      }

      await this.prisma.clinic.delete({
        where: { id },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Clinic deleted successfully',
        'ClinicService',
        { clinicId: id }
      );

      await this.eventService.emit('clinic.deleted', {
        clinicId: id,
        deletedBy: userId
      });

      return { message: 'Clinic deleted successfully' };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to delete clinic',
        'ClinicService',
        { error: error.message, clinicId: id }
      );
      throw error;
    }
  }
} 